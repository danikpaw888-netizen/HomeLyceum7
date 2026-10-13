import json
import os
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user, require_roles
from ..config import settings
from ..database import get_db
from ..events import log_action, notify_student_and_parents, notify_users
from ..access import norm_subject, teacher_subjects_in_class
from ..storage import store_upload

router = APIRouter(prefix="/submissions", tags=["submissions"])
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".txt", ".jpg", ".jpeg", ".png", ".heic", ".zip", ".rar", ".xlsx", ".xls", ".ppt", ".pptx"}
MAX_FILE_SIZE = 20 * 1024 * 1024
MAX_FILES = 10


async def _save_uploads(upload_files: List[UploadFile]) -> List[dict]:
    if len(upload_files) > MAX_FILES:
        raise HTTPException(status_code=400, detail="К одному ответу можно прикрепить не более 10 файлов")
    buffered = []
    for upload in upload_files:
        ext = os.path.splitext(upload.filename or "")[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"Недопустимый тип файла: {ext or 'без расширения'}")
        contents = await upload.read()
        if len(contents) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail=f"Файл «{upload.filename}» превышает 20 МБ")
        buffered.append((upload.filename, ext, contents, upload.content_type))
    result = []
    for filename, ext, contents, content_type in buffered:
        name = f"{uuid.uuid4().hex}{ext}"
        file_path = f"/uploads/{name}"
        store_upload(file_path, filename, contents, content_type)
        result.append({"file_path": file_path, "original_filename": filename})
    return result


@router.post("/{assignment_id}", response_model=schemas.SubmissionOut)
async def save_homework_draft(
    assignment_id: int,
    comment: str = Form(""),
    clear_files: bool = Form(False),
    file: Optional[UploadFile] = File(None),
    files: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("student")),
):
    """Save work as a draft; teachers do not see it until the student turns it in."""
    assignment = db.query(models.Assignment).filter(
        models.Assignment.id == assignment_id, models.Assignment.is_active.is_(True)
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Задание не найдено или оно уже закрыто")
    enrolled = db.query(models.Enrollment).filter(
        models.Enrollment.class_id == assignment.class_id,
        models.Enrollment.student_id == current_user.id,
    ).first()
    if not enrolled:
        raise HTTPException(status_code=403, detail="Вы не состоите в этом классе")

    existing = db.query(models.Submission).filter(
        models.Submission.assignment_id == assignment_id,
        models.Submission.student_id == current_user.id,
    ).first()
    if existing and existing.is_submitted:
        raise HTTPException(status_code=400, detail="Сначала отмените сдачу, чтобы изменить прикреплённые файлы")

    upload_files = [f for f in (files or []) if f and f.filename]
    if file and file.filename:
        upload_files.append(file)
    if len(upload_files) > MAX_FILES:
        raise HTTPException(status_code=400, detail="К одному ответу можно прикрепить не более 10 файлов")
    uploads = await _save_uploads(upload_files)

    if existing:
        if clear_files and not uploads:
            for attachment in existing.attachments:
                if attachment.is_current:
                    attachment.is_current = False
            existing.file_path = None
            existing.original_filename = None
        if uploads:
            for attachment in existing.attachments:
                if attachment.is_current:
                    attachment.is_current = False
            for upload in uploads:
                existing.attachments.append(models.SubmissionAttachment(
                    **upload, is_current=True, attempt_number=max(1, (existing.attempt_count or 0) + 1)
                ))
            existing.file_path = uploads[0]["file_path"]
            existing.original_filename = uploads[0]["original_filename"]
        existing.comment = comment
        log_action(
            db, current_user, "save_draft", "submission", existing.id,
            f"Сохранён черновик работы по заданию «{assignment.title}»",
            after={"assignment_id": assignment.id, "files": [x["original_filename"] for x in uploads],
                   "clear_files": clear_files},
        )
        submission = existing
    else:
        submission = models.Submission(
            assignment_id=assignment_id,
            student_id=current_user.id,
            file_path=uploads[0]["file_path"] if uploads else None,
            original_filename=uploads[0]["original_filename"] if uploads else None,
            comment=comment,
            attempt_count=0,
            is_submitted=False,
            submitted_at=None,
        )
        db.add(submission)
        db.flush()
        for upload in uploads:
            submission.attachments.append(models.SubmissionAttachment(
                **upload, is_current=True, attempt_number=1
            ))
        log_action(
            db, current_user, "create_draft", "submission", submission.id,
            f"Создан черновик работы по заданию «{assignment.title}»",
            after={"assignment_id": assignment.id, "files": [x["original_filename"] for x in uploads]},
        )

    db.commit()
    db.refresh(submission)
    return submission


@router.put("/{submission_id}/turn-in", response_model=schemas.SubmissionOut)
def turn_in_homework(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("student")),
):
    """Send prepared draft to the teacher."""
    submission = db.query(models.Submission).filter(
        models.Submission.id == submission_id,
        models.Submission.student_id == current_user.id,
    ).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Работа не найдена")
    if submission.is_submitted:
        raise HTTPException(status_code=400, detail="Работа уже сдана")
    assignment = submission.assignment
    if not assignment or not assignment.is_active:
        raise HTTPException(status_code=404, detail="Задание не найдено или оно уже закрыто")

    previous_attempts = max(0, submission.attempt_count or 0)
    max_attempts = max(1, assignment.max_attempts or 1)
    if previous_attempts == 0:
        next_attempt = 1
    elif assignment.allow_resubmission and previous_attempts < max_attempts:
        next_attempt = previous_attempts + 1
    else:
        # Re-turning in after cancelling a submission edits the same work item.
        next_attempt = previous_attempts

    submission.is_submitted = True
    submission.submitted_at = datetime.utcnow()
    submission.attempt_count = next_attempt
    submission.grade = None
    submission.teacher_feedback = ""
    submission.graded_at = None
    log_action(
        db, current_user, "turn_in", "submission", submission.id,
        f"Сдана работа по заданию «{assignment.title}»",
        before={"is_submitted": False, "attempt_count": previous_attempts},
        after={"is_submitted": True, "attempt_count": submission.attempt_count,
               "files": [a.original_filename for a in submission.attachments if a.is_current]},
    )
    notify_users(
        db, [assignment.teacher_id] if assignment.teacher_id else [],
        "submission", "Получена работа",
        f"Ученик {current_user.full_name} сдал работу «{assignment.title}».", "/",
    )
    db.commit()
    db.refresh(submission)
    return submission


@router.put("/{submission_id}/unsubmit", response_model=schemas.SubmissionOut)
def unsubmit_homework(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("student")),
):
    """Cancel turn-in without losing files; the submission becomes editable again."""
    submission = db.query(models.Submission).filter(
        models.Submission.id == submission_id,
        models.Submission.student_id == current_user.id,
    ).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Работа не найдена")
    if not submission.is_submitted:
        raise HTTPException(status_code=400, detail="Работа уже находится в черновиках")
    assignment = submission.assignment
    if not assignment:
        raise HTTPException(status_code=404, detail="Задание не найдено")

    current_files = [
        {"file_path": a.file_path, "original_filename": a.original_filename}
        for a in submission.attachments if a.is_current
    ]
    linked_grade = db.query(models.GradeEntry).filter(
        models.GradeEntry.submission_id == submission.id
    ).first()
    if linked_grade:
        log_action(
            db, current_user, "delete", "grade", linked_grade.id,
            f"Оценка по домашнему заданию «{assignment.title}» убрана из текущего журнала после отмены сдачи",
            before={"grade": linked_grade.grade, "submission_id": submission.id},
        )
        db.delete(linked_grade)

    db.add(models.SubmissionAttempt(
        submission_id=submission.id,
        attempt_number=max(1, submission.attempt_count or 1),
        file_path=submission.file_path,
        original_filename=submission.original_filename,
        comment=submission.comment,
        grade=submission.grade,
        teacher_feedback=submission.teacher_feedback,
        submitted_at=submission.submitted_at,
        graded_at=submission.graded_at,
        attachments_json=json.dumps(current_files, ensure_ascii=False),
    ))
    before = {
        "is_submitted": True,
        "attempt_count": submission.attempt_count,
        "grade": submission.grade,
        "submitted_at": submission.submitted_at,
    }
    submission.is_submitted = False
    submission.submitted_at = None
    submission.grade = None
    submission.teacher_feedback = ""
    submission.graded_at = None
    log_action(
        db, current_user, "unsubmit", "submission", submission.id,
        f"Отменена сдача работы по заданию «{assignment.title}»",
        before=before, after={"is_submitted": False, "draft_preserved": True},
    )
    db.commit()
    db.refresh(submission)
    return submission


@router.get("/assignment/{assignment_id}", response_model=List[schemas.SubmissionOut])
def list_submissions_for_assignment(assignment_id: int, db: Session = Depends(get_db),
                                    current_user: models.User = Depends(require_roles("teacher", "admin"))):
    assignment = db.query(models.Assignment).filter(
        models.Assignment.id == assignment_id
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Задание не найдено")
    role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role
    if role == "teacher" and norm_subject(assignment.subject) not in teacher_subjects_in_class(
        db, current_user.id, assignment.class_id
    ):
        raise HTTPException(status_code=403, detail="Проверять можно только задания по вашим предметам")
    return db.query(models.Submission).filter(
        models.Submission.assignment_id == assignment_id,
        models.Submission.is_submitted.is_(True),
    ).all()


@router.get("/my", response_model=List[schemas.SubmissionOut])
def my_submissions(db: Session = Depends(get_db),
                   current_user: models.User = Depends(require_roles("student"))):
    return db.query(models.Submission).filter(models.Submission.student_id == current_user.id).all()


@router.get("/child/{student_id}", response_model=List[schemas.SubmissionOut])
def child_submissions(student_id: int, db: Session = Depends(get_db),
                      current_user: models.User = Depends(require_roles("parent"))):
    link = db.query(models.ParentStudent).filter(
        models.ParentStudent.parent_id == current_user.id, models.ParentStudent.student_id == student_id
    ).first()
    if not link:
        raise HTTPException(status_code=403, detail="Это не ваш ребёнок")
    return db.query(models.Submission).filter(models.Submission.student_id == student_id).all()


@router.put("/{submission_id}/grade", response_model=schemas.SubmissionOut)
def grade_submission(submission_id: int, grade_in: schemas.GradeIn, db: Session = Depends(get_db),
                     current_user: models.User = Depends(require_roles("teacher", "admin"))):
    submission = db.query(models.Submission).filter(models.Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Работа не найдена")
    role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role
    assignment = submission.assignment
    if not submission.is_submitted:
        raise HTTPException(status_code=400, detail="Нельзя оценить работу, которую ученик не сдал")
    if role == "teacher" and (
        assignment is None or norm_subject(assignment.subject) not in teacher_subjects_in_class(
            db, current_user.id, assignment.class_id
        )
    ):
        raise HTTPException(status_code=403, detail="Проверять и оценивать можно только задания по вашим предметам")
    if not (1 <= grade_in.grade <= 10):
        raise HTTPException(status_code=400, detail="Оценка должна быть от 1 до 10")
    before = {"grade": submission.grade, "teacher_feedback": submission.teacher_feedback}
    submission.grade = grade_in.grade
    submission.teacher_feedback = grade_in.teacher_feedback
    submission.graded_at = datetime.utcnow()

    if assignment is not None:
        journal_entry = db.query(models.GradeEntry).filter(
            models.GradeEntry.submission_id == submission.id
        ).first()
        journal_comment = f"Домашнее задание: {assignment.title}"
        if grade_in.teacher_feedback:
            journal_comment += f"\\nКомментарий учителя: {grade_in.teacher_feedback}"
        if journal_entry is None:
            journal_entry = models.GradeEntry(
                student_id=submission.student_id,
                class_id=assignment.class_id,
                teacher_id=current_user.id,
                subject=(assignment.subject or "Без предмета").strip(),
                grade=grade_in.grade,
                # Use the assignment's issue date consistently in the journal.
                date=(assignment.created_at or submission.graded_at).date(),
                comment=journal_comment,
                submission_id=submission.id,
            )
            db.add(journal_entry)
        else:
            journal_entry.student_id = submission.student_id
            journal_entry.class_id = assignment.class_id
            journal_entry.teacher_id = current_user.id
            journal_entry.subject = (assignment.subject or "Без предмета").strip()
            journal_entry.grade = grade_in.grade
            journal_entry.date = (assignment.created_at or submission.graded_at).date()
            journal_entry.comment = journal_comment

    log_action(db, current_user, "grade", "submission", submission.id,
               f"Поставлена оценка {grade_in.grade}/10 за «{submission.assignment.title}»",
               before=before, after={"grade": submission.grade, "teacher_feedback": submission.teacher_feedback})
    notify_student_and_parents(db, submission.student_id, "grade", "Работа проверена",
                               f"За задание «{submission.assignment.title}» выставлена оценка {submission.grade}/10.", "/")
    db.commit()
    db.refresh(submission)
    return submission
