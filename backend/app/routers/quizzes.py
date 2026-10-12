import json
from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user, require_roles
from ..database import get_db
from ..events import log_action, notify_student_and_parents, notify_users

router = APIRouter(prefix="/quizzes", tags=["online quizzes"])


def _role(user: models.User) -> str:
    return user.role.value if hasattr(user.role, "value") else str(user.role)


def _class_or_404(db: Session, class_id: int) -> models.ClassRoom:
    room = db.query(models.ClassRoom).filter(
        models.ClassRoom.id == class_id, models.ClassRoom.is_active.is_(True)
    ).first()
    if not room:
        raise HTTPException(status_code=404, detail="Активный класс не найден")
    return room


def _can_manage(db: Session, quiz: models.Quiz, user: models.User) -> bool:
    role = _role(user)
    if role == "admin" or quiz.teacher_id == user.id:
        return True
    room = db.query(models.ClassRoom).filter(models.ClassRoom.id == quiz.class_id).first()
    if room and room.teacher_id == user.id:
        return True
    return bool(db.query(models.ScheduleLesson.id).filter(
        models.ScheduleLesson.class_id == quiz.class_id,
        models.ScheduleLesson.teacher_id == user.id,
    ).first())


def _require_class_student(db: Session, quiz: models.Quiz, student_id: int) -> None:
    if not db.query(models.Enrollment.id).filter(
        models.Enrollment.class_id == quiz.class_id,
        models.Enrollment.student_id == student_id,
    ).first():
        raise HTTPException(status_code=403, detail="Вы не состоите в классе этого теста")


def _quiz_or_404(db: Session, quiz_id: int, active_only: bool = True) -> models.Quiz:
    query = db.query(models.Quiz).filter(models.Quiz.id == quiz_id)
    if active_only:
        query = query.filter(models.Quiz.is_active.is_(True))
    quiz = query.first()
    if not quiz:
        raise HTTPException(status_code=404, detail="Тест не найден")
    return quiz


def _attempt_payload(attempt: models.QuizAttempt) -> dict:
    answers = []
    for answer in attempt.answers:
        question = answer.question
        try:
            selected_ids = json.loads(answer.selected_option_ids or "[]")
        except (ValueError, TypeError):
            selected_ids = []
        option_names = {option.id: option.option_text for option in question.options}
        answers.append({
            "id": answer.id,
            "question_id": question.id,
            "question_text": question.question_text,
            "question_type": question.question_type,
            "points_available": question.points,
            "selected_option_ids": selected_ids,
            "selected_options": [option_names[x] for x in selected_ids if x in option_names],
            "text_answer": answer.text_answer or "",
            "is_correct": answer.is_correct,
            "points_awarded": answer.points_awarded,
            "feedback": answer.feedback or "",
        })
    return {
        "id": attempt.id,
        "quiz_id": attempt.quiz_id,
        "student_id": attempt.student_id,
        "student_name": attempt.student.full_name if attempt.student else None,
        "attempt_number": attempt.attempt_number,
        "status": attempt.status,
        "started_at": attempt.started_at,
        "submitted_at": attempt.submitted_at,
        "score": attempt.score,
        "max_score": attempt.max_score,
        "answers": answers,
    }


@router.post("/", response_model=schemas.QuizOut)
def create_quiz(
    quiz_in: schemas.QuizCreateIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    room = _class_or_404(db, quiz_in.class_id)
    if _role(current_user) == "teacher" and not (
        current_user.id == room.teacher_id or db.query(models.ScheduleLesson.id).filter(
            models.ScheduleLesson.class_id == room.id,
            models.ScheduleLesson.teacher_id == current_user.id,
        ).first()
    ):
        raise HTTPException(status_code=403, detail="Создать тест может только учитель этого класса")
    if not quiz_in.title.strip():
        raise HTTPException(status_code=400, detail="Укажите название теста")
    if not 1 <= quiz_in.attempts_allowed <= 10:
        raise HTTPException(status_code=400, detail="Разрешено от 1 до 10 попыток")
    if quiz_in.duration_minutes is not None and not 1 <= quiz_in.duration_minutes <= 180:
        raise HTTPException(status_code=400, detail="Длительность должна быть от 1 до 180 минут")
    if quiz_in.deadline and quiz_in.deadline <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="Срок теста должен быть в будущем")
    if not 1 <= len(quiz_in.questions) <= 100:
        raise HTTPException(status_code=400, detail="Тест должен содержать от 1 до 100 вопросов")

    quiz = models.Quiz(
        class_id=room.id, teacher_id=current_user.id, subject=quiz_in.subject.strip(),
        title=quiz_in.title.strip(), description=quiz_in.description.strip(),
        deadline=quiz_in.deadline, duration_minutes=quiz_in.duration_minutes,
        attempts_allowed=quiz_in.attempts_allowed, is_published=quiz_in.is_published, is_active=True,
    )
    db.add(quiz)
    db.flush()
    for question_index, question_in in enumerate(quiz_in.questions):
        if not question_in.question_text.strip():
            raise HTTPException(status_code=400, detail=f"У вопроса {question_index + 1} пустой текст")
        if not 1 <= question_in.points <= 100:
            raise HTTPException(status_code=400, detail="За вопрос можно назначить от 1 до 100 баллов")
        options = question_in.options
        correct = question_in.correct_option_indexes
        if question_in.question_type == "text":
            if options or correct:
                raise HTTPException(status_code=400, detail="У текстового вопроса не должно быть вариантов ответа")
        else:
            if len(options) < 2:
                raise HTTPException(status_code=400, detail=f"У вопроса {question_index + 1} должно быть минимум 2 варианта")
            if not correct or any(index < 0 or index >= len(options) for index in correct):
                raise HTTPException(status_code=400, detail=f"Отметьте правильный ответ у вопроса {question_index + 1}")
            if question_in.question_type == "single" and len(correct) != 1:
                raise HTTPException(status_code=400, detail="Для одиночного выбора нужен ровно один правильный ответ")
            if len({option.option_text.strip() for option in options}) != len(options) or any(not option.option_text.strip() for option in options):
                raise HTTPException(status_code=400, detail="Варианты ответа должны быть непустыми и не повторяться")
        question = models.QuizQuestion(
            quiz_id=quiz.id, question_text=question_in.question_text.strip(),
            question_type=question_in.question_type, points=question_in.points, order_index=question_index,
        )
        db.add(question)
        db.flush()
        for option_index, option in enumerate(options):
            db.add(models.QuizOption(
                question_id=question.id, option_text=option.option_text.strip(),
                is_correct=option_index in correct, order_index=option_index,
            ))

    student_ids = [item.student_id for item in db.query(models.Enrollment).filter(
        models.Enrollment.class_id == room.id).all()]
    parent_ids = [item.parent_id for item in db.query(models.ParentStudent).filter(
        models.ParentStudent.student_id.in_(student_ids or [-1])).all()]
    if quiz.is_published:
        notify_users(db, [*student_ids, *parent_ids], "quiz", "Новый тест",
                     f"{quiz.subject + ': ' if quiz.subject else ''}{quiz.title}", "/")
    log_action(db, current_user, "create", "quiz", quiz.id,
               f"Создан тест «{quiz.title}» для класса {room.name}",
               after={"title": quiz.title, "class_id": room.id, "questions": len(quiz_in.questions),
                      "published": quiz.is_published})
    db.commit()
    db.refresh(quiz)
    return quiz


@router.get("/class/{class_id}", response_model=List[schemas.QuizOut])
def class_quizzes(
    class_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    _class_or_404(db, class_id)
    query = db.query(models.Quiz).filter(
        models.Quiz.class_id == class_id, models.Quiz.is_active.is_(True)
    )
    if _role(current_user) == "teacher":
        query = query.filter(models.Quiz.teacher_id == current_user.id)
    return query.order_by(models.Quiz.created_at.desc()).all()


@router.get("/my", response_model=List[schemas.StudentQuizOut])
def my_quizzes(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("student")),
):
    class_ids = [row.class_id for row in db.query(models.Enrollment).filter(
        models.Enrollment.student_id == current_user.id
    ).all()]
    if not class_ids:
        return []
    quizzes = db.query(models.Quiz).filter(
        models.Quiz.class_id.in_(class_ids),
        models.Quiz.is_active.is_(True),
        models.Quiz.is_published.is_(True),
    ).order_by(models.Quiz.deadline.asc().nullslast(), models.Quiz.created_at.desc()).all()
    payload = []
    now = datetime.utcnow()
    for quiz in quizzes:
        attempts = db.query(models.QuizAttempt).filter(
            models.QuizAttempt.quiz_id == quiz.id,
            models.QuizAttempt.student_id == current_user.id,
        ).order_by(models.QuizAttempt.attempt_number.desc()).all()
        latest = attempts[0] if attempts else None
        has_active = bool(latest and latest.status == "in_progress")
        can_attempt = has_active or (
            len(attempts) < quiz.attempts_allowed and (quiz.deadline is None or quiz.deadline > now)
        )
        item = schemas.QuizOut.model_validate(quiz).model_dump()
        item.update({
            "attempts_used": len(attempts),
            "latest_attempt_id": latest.id if latest else None,
            "latest_attempt_status": latest.status if latest else None,
            "latest_score": latest.score if latest and latest.status != "in_progress" else None,
            "latest_max_score": latest.max_score if latest and latest.status != "in_progress" else None,
            "can_attempt": can_attempt,
        })
        payload.append(item)
    return payload


@router.post("/{quiz_id}/attempts", response_model=schemas.QuizAttemptStartOut)
def start_quiz_attempt(
    quiz_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("student")),
):
    quiz = _quiz_or_404(db, quiz_id)
    if not quiz.is_published:
        raise HTTPException(status_code=403, detail="Тест ещё не опубликован")
    _require_class_student(db, quiz, current_user.id)
    now = datetime.utcnow()
    if quiz.deadline and quiz.deadline <= now:
        raise HTTPException(status_code=400, detail="Срок прохождения теста истёк")
    attempts = db.query(models.QuizAttempt).filter(
        models.QuizAttempt.quiz_id == quiz.id,
        models.QuizAttempt.student_id == current_user.id,
    ).order_by(models.QuizAttempt.attempt_number.desc()).all()
    if attempts and attempts[0].status == "in_progress":
        ongoing = attempts[0]
        if quiz.duration_minutes and now > ongoing.started_at + timedelta(minutes=quiz.duration_minutes, seconds=15):
            ongoing.status = "expired"
            ongoing.submitted_at = now
            db.commit()
        else:
            return ongoing
    attempts = db.query(models.QuizAttempt).filter(
        models.QuizAttempt.quiz_id == quiz.id,
        models.QuizAttempt.student_id == current_user.id,
    ).all()
    if len(attempts) >= quiz.attempts_allowed:
        raise HTTPException(status_code=400, detail="Попытки прохождения теста закончились")
    max_score = sum(question.points for question in quiz.questions)
    attempt = models.QuizAttempt(
        quiz_id=quiz.id, student_id=current_user.id,
        attempt_number=len(attempts) + 1, status="in_progress",
        started_at=now, max_score=max_score,
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return attempt


@router.put("/attempts/{attempt_id}/submit", response_model=schemas.QuizAttemptOut)
def submit_quiz_attempt(
    attempt_id: int,
    submission_in: schemas.QuizSubmissionIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("student")),
):
    attempt = db.query(models.QuizAttempt).filter(
        models.QuizAttempt.id == attempt_id,
        models.QuizAttempt.student_id == current_user.id,
    ).first()
    if not attempt:
        raise HTTPException(status_code=404, detail="Попытка не найдена")
    if attempt.status != "in_progress":
        raise HTTPException(status_code=400, detail="Эта попытка уже отправлена")
    quiz = _quiz_or_404(db, attempt.quiz_id, active_only=False)
    now = datetime.utcnow()
    if quiz.duration_minutes and now > attempt.started_at + timedelta(minutes=quiz.duration_minutes, seconds=15):
        attempt.status = "expired"
        attempt.submitted_at = now
        db.commit()
        raise HTTPException(status_code=400, detail="Время прохождения теста истекло")
    answer_map = {answer.question_id: answer for answer in submission_in.answers}
    if len(answer_map) != len(submission_in.answers):
        raise HTTPException(status_code=400, detail="Один вопрос указан несколько раз")
    question_map = {question.id: question for question in quiz.questions}
    if any(question_id not in question_map for question_id in answer_map):
        raise HTTPException(status_code=400, detail="Ответ содержит вопрос из другого теста")

    total_score = 0
    needs_review = False
    for question in quiz.questions:
        answer_in = answer_map.get(question.id)
        selected = list(dict.fromkeys(answer_in.selected_option_ids if answer_in else []))
        text_answer = (answer_in.text_answer if answer_in else "").strip()
        options_by_id = {option.id: option for option in question.options}
        if any(option_id not in options_by_id for option_id in selected):
            raise HTTPException(status_code=400, detail="Выбранный вариант не относится к этому вопросу")
        if question.question_type == "single" and len(selected) > 1:
            raise HTTPException(status_code=400, detail="В вопросе с одиночным выбором разрешён один ответ")
        if question.question_type == "text" and selected:
            raise HTTPException(status_code=400, detail="У текстового вопроса нельзя выбирать варианты")
        correct_ids = {option.id for option in question.options if option.is_correct}
        is_correct = None
        awarded = 0
        if question.question_type == "text":
            if text_answer:
                needs_review = True
            else:
                is_correct = False
        else:
            is_correct = set(selected) == correct_ids
            if is_correct:
                awarded = question.points
        total_score += awarded
        db.add(models.QuizAnswer(
            attempt_id=attempt.id, question_id=question.id,
            selected_option_ids=json.dumps(selected), text_answer=text_answer,
            is_correct=is_correct, points_awarded=awarded,
        ))
    attempt.score = total_score
    attempt.submitted_at = now
    attempt.status = "pending_review" if needs_review else "submitted"
    log_action(db, current_user, "submit", "quiz_attempt", attempt.id,
               f"Сдан тест «{quiz.title}» ({total_score}/{attempt.max_score})",
               after={"quiz_id": quiz.id, "score": total_score, "max_score": attempt.max_score,
                      "status": attempt.status})
    teacher_ids = [quiz.teacher_id] if quiz.teacher_id else []
    notify_users(db, teacher_ids, "quiz_submission", "Сдан тест",
                 f"{current_user.full_name} отправил тест «{quiz.title}».", "/")
    db.commit()
    db.refresh(attempt)
    notify_student_and_parents(db, current_user.id, "quiz_submitted", "Тест отправлен",
                               f"Ответы по тесту «{quiz.title}» сохранены. Текущий результат: {attempt.score}/{attempt.max_score}.", "/")
    db.commit()
    db.refresh(attempt)
    return _attempt_payload(attempt)


@router.get("/{quiz_id}/attempts", response_model=List[schemas.QuizAttemptOut])
def quiz_attempts(
    quiz_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    quiz = _quiz_or_404(db, quiz_id, active_only=False)
    if not _can_manage(db, quiz, current_user):
        raise HTTPException(status_code=403, detail="Вы не можете проверять этот тест")
    attempts = db.query(models.QuizAttempt).filter(
        models.QuizAttempt.quiz_id == quiz.id
    ).order_by(models.QuizAttempt.started_at.desc()).all()
    return [_attempt_payload(attempt) for attempt in attempts]


@router.put("/attempts/{attempt_id}/grade", response_model=schemas.QuizAttemptOut)
def grade_quiz_attempt(
    attempt_id: int,
    grade_in: schemas.QuizAttemptGradeIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    attempt = db.query(models.QuizAttempt).filter(models.QuizAttempt.id == attempt_id).first()
    if not attempt:
        raise HTTPException(status_code=404, detail="Попытка не найдена")
    if not _can_manage(db, attempt.quiz, current_user):
        raise HTTPException(status_code=403, detail="Вы не можете проверять этот тест")
    if attempt.status not in ("pending_review", "submitted", "graded"):
        raise HTTPException(status_code=400, detail="Эта попытка ещё не отправлена")
    answers = {answer.id: answer for answer in attempt.answers}
    for update in grade_in.answers:
        answer = answers.get(update.answer_id)
        if not answer:
            raise HTTPException(status_code=400, detail="Ответ не относится к этой попытке")
        if answer.question.question_type != "text":
            raise HTTPException(status_code=400, detail="Вручную можно оценивать только текстовые ответы")
        if not 0 <= update.points_awarded <= answer.question.points:
            raise HTTPException(status_code=400, detail=f"Баллы должны быть от 0 до {answer.question.points}")
        answer.points_awarded = update.points_awarded
        answer.feedback = update.feedback
        answer.is_correct = update.points_awarded == answer.question.points
    attempt.score = sum(answer.points_awarded for answer in attempt.answers)
    attempt.status = "graded"
    log_action(db, current_user, "grade", "quiz_attempt", attempt.id,
               f"Проверен тест «{attempt.quiz.title}»: {attempt.score}/{attempt.max_score}",
               after={"score": attempt.score, "max_score": attempt.max_score, "status": attempt.status})
    db.commit()
    db.refresh(attempt)
    notify_student_and_parents(db, attempt.student_id, "quiz_graded", "Тест проверен",
                               f"Результат теста «{attempt.quiz.title}»: {attempt.score}/{attempt.max_score}.", "/")
    db.commit()
    db.refresh(attempt)
    return _attempt_payload(attempt)


@router.delete("/{quiz_id}")
def deactivate_quiz(
    quiz_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    quiz = _quiz_or_404(db, quiz_id)
    if not _can_manage(db, quiz, current_user):
        raise HTTPException(status_code=403, detail="Вы не можете изменить этот тест")
    quiz.is_active = False
    log_action(db, current_user, "soft_delete", "quiz", quiz.id,
               f"Тест «{quiz.title}» скрыт; попытки и результаты сохранены",
               before={"is_active": True}, after={"is_active": False})
    db.commit()
    return {"status": "ok"}
