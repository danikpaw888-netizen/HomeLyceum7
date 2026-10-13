from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..access import can_grade_subject, role_value, teacher_class_ids
from ..auth import get_current_user, require_roles
from ..database import get_db
from ..events import log_action

router = APIRouter(prefix="/gradebook", tags=["gradebook"])

NOT_YOUR_SUBJECT = "Вы не преподаёте этот предмет в этом классе"


def _class_or_403(db: Session, class_id: int, current_user: models.User) -> models.ClassRoom:
    role = role_value(current_user)
    class_room = db.query(models.ClassRoom).filter(models.ClassRoom.id == class_id).first()
    if not class_room:
        raise HTTPException(status_code=404, detail="Класс не найден")
    if role == "admin":
        return class_room
    if role == "teacher" and class_room.id in teacher_class_ids(db, current_user.id):
        return class_room
    raise HTTPException(status_code=403, detail="Нет доступа к этому классу")


def _assert_can_view_student(db: Session, current_user: models.User, student_id: int) -> None:
    role = role_value(current_user)

    if role == "admin":
        return
    if role == "student":
        if current_user.id != student_id:
            raise HTTPException(status_code=403, detail="Нет доступа")
        return
    if role == "parent":
        link = db.query(models.ParentStudent).filter(
            models.ParentStudent.parent_id == current_user.id,
            models.ParentStudent.student_id == student_id,
        ).first()
        if not link:
            raise HTTPException(status_code=403, detail="Это не ваш ребёнок")
        return
    if role == "teacher":
        class_ids = teacher_class_ids(db, current_user.id)
        enrolled = None
        if class_ids:
            enrolled = db.query(models.Enrollment).filter(
                models.Enrollment.student_id == student_id,
                models.Enrollment.class_id.in_(class_ids),
            ).first()
        if not enrolled:
            raise HTTPException(status_code=403, detail="Этот ученик не в ваших классах")
        return
    raise HTTPException(status_code=403, detail="Нет доступа")


@router.get("/classes", response_model=List[schemas.ClassOut])
def journal_classes(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    """Активные классы, доступные в журнале: для учителя — все активные классы,
    для администратора — также все активные классы."""
    active_filter = models.ClassRoom.is_active.is_(True)
    if role_value(current_user) == "admin":
        return db.query(models.ClassRoom).filter(active_filter).order_by(models.ClassRoom.name).all()
    ids = teacher_class_ids(db, current_user.id)
    if not ids:
        return []
    return db.query(models.ClassRoom).filter(
        models.ClassRoom.id.in_(ids),
        active_filter,
    ).order_by(models.ClassRoom.name).all()


@router.get("/class/{class_id}/roster", response_model=schemas.RosterOut)
def class_roster(
    class_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    """Список учеников класса с их оценками, посещаемостью и статусом домашнего обучения."""
    _class_or_403(db, class_id, current_user)

    enrollments = db.query(models.Enrollment).filter(models.Enrollment.class_id == class_id).all()
    students_out = []

    for e in enrollments:
        student = db.query(models.User).filter(models.User.id == e.student_id).first()
        if not student:
            continue

        grades = db.query(models.GradeEntry).filter(
            models.GradeEntry.class_id == class_id, models.GradeEntry.student_id == student.id
        ).order_by(models.GradeEntry.date.desc()).all()

        attendance = db.query(models.Attendance).filter(
            models.Attendance.class_id == class_id, models.Attendance.student_id == student.id
        ).order_by(models.Attendance.date.desc()).limit(2000).all()

        active_homeschool = db.query(models.HomeschoolRecord).filter(
            models.HomeschoolRecord.student_id == student.id,
            models.HomeschoolRecord.end_date.is_(None),
        ).first()

        students_out.append(schemas.RosterStudent(
            id=student.id,
            full_name=student.full_name,
            email=student.email,
            grades=[schemas.GradeEntryOut.model_validate(g) for g in grades],
            attendance=[schemas.AttendanceOut.model_validate(a) for a in attendance],
            on_homeschool=active_homeschool is not None,
        ))

    return schemas.RosterOut(class_id=class_id, students=students_out)


@router.post("/grades", response_model=schemas.GradeEntryOut)
def add_grade(
    grade_in: schemas.GradeEntryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    class_room = _class_or_403(db, grade_in.class_id, current_user)

    if not can_grade_subject(db, current_user, class_room, grade_in.subject):
        raise HTTPException(status_code=403, detail=NOT_YOUR_SUBJECT)

    if not (1 <= grade_in.grade <= 10):
        raise HTTPException(status_code=400, detail="Оценка должна быть от 1 до 10")

    enrolled = db.query(models.Enrollment).filter(
        models.Enrollment.class_id == grade_in.class_id,
        models.Enrollment.student_id == grade_in.student_id,
    ).first()
    if not enrolled:
        raise HTTPException(status_code=400, detail="Ученик не состоит в этом классе")

    entry = models.GradeEntry(
        student_id=grade_in.student_id,
        class_id=grade_in.class_id,
        teacher_id=current_user.id,
        subject=grade_in.subject.strip(),
        grade=grade_in.grade,
        date=grade_in.date,
        comment=grade_in.comment,
    )
    db.add(entry)
    db.flush()
    log_action(db, current_user, "create", "grade", entry.id, f"Добавлена оценка {entry.grade} ученику #{entry.student_id}",
               after={"student_id": entry.student_id, "class_id": entry.class_id, "subject": entry.subject, "grade": entry.grade})
    db.commit()
    db.refresh(entry)
    return entry


@router.put("/grades/{grade_id}", response_model=schemas.GradeEntryOut)
def update_grade(
    grade_id: int,
    grade_in: schemas.GradeEntryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    entry = db.query(models.GradeEntry).filter(models.GradeEntry.id == grade_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Оценка не найдена")
    class_room = _class_or_403(db, entry.class_id, current_user)
    if not can_grade_subject(db, current_user, class_room, entry.subject):
        raise HTTPException(status_code=403, detail=NOT_YOUR_SUBJECT)

    if not (1 <= grade_in.grade <= 10):
        raise HTTPException(status_code=400, detail="Оценка должна быть от 1 до 10")

    before = {"grade": entry.grade, "comment": entry.comment}
    entry.grade = grade_in.grade
    if grade_in.comment is not None:
        entry.comment = grade_in.comment
    if entry.submission_id is not None:
        linked_submission = db.query(models.Submission).filter(
            models.Submission.id == entry.submission_id
        ).first()
        if linked_submission:
            linked_submission.grade = grade_in.grade
            linked_submission.graded_at = datetime.utcnow()
    log_action(db, current_user, "update", "grade", entry.id, f"Изменена оценка ученика #{entry.student_id}",
               before=before, after={"grade": entry.grade, "comment": entry.comment})
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/grades/{grade_id}")
def delete_grade(
    grade_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    entry = db.query(models.GradeEntry).filter(models.GradeEntry.id == grade_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Оценка не найдена")
    class_room = _class_or_403(db, entry.class_id, current_user)
    if not can_grade_subject(db, current_user, class_room, entry.subject):
        raise HTTPException(status_code=403, detail=NOT_YOUR_SUBJECT)
    log_action(db, current_user, "delete", "grade", entry.id, f"Удалена оценка ученика #{entry.student_id}",
               before={"grade": entry.grade, "subject": entry.subject, "student_id": entry.student_id,
                       "submission_id": entry.submission_id})
    if entry.submission_id is not None:
        linked_submission = db.query(models.Submission).filter(
            models.Submission.id == entry.submission_id
        ).first()
        if linked_submission:
            linked_submission.grade = None
            linked_submission.graded_at = None
            linked_submission.teacher_feedback = ""
    db.delete(entry)
    db.commit()
    return {"status": "ok"}


@router.post("/attendance", response_model=schemas.AttendanceOut)
def mark_attendance(
    att_in: schemas.AttendanceCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    class_room = _class_or_403(db, att_in.class_id, current_user)

    if not can_grade_subject(db, current_user, class_room, att_in.subject):
        raise HTTPException(status_code=403, detail=NOT_YOUR_SUBJECT)

    if att_in.status == models.AttendanceStatus.late:
        raise HTTPException(status_code=400, detail="В журнале доступны только: был, отсутствовал, уважительная причина")

    enrolled = db.query(models.Enrollment).filter(
        models.Enrollment.class_id == att_in.class_id,
        models.Enrollment.student_id == att_in.student_id,
    ).first()
    if not enrolled:
        raise HTTPException(status_code=400, detail="Ученик не состоит в этом классе")

    existing = db.query(models.Attendance).filter(
        models.Attendance.class_id == att_in.class_id,
        models.Attendance.student_id == att_in.student_id,
        models.Attendance.subject == att_in.subject,
        models.Attendance.date == att_in.date,
    ).first()

    if existing:
        before = {"status": existing.status.value if hasattr(existing.status, "value") else existing.status, "note": existing.note}
        existing.status = att_in.status
        existing.note = att_in.note
        existing.teacher_id = current_user.id
        log_action(db, current_user, "update", "attendance", existing.id, f"Изменена посещаемость ученика #{existing.student_id}",
                   before=before, after={"status": att_in.status.value if hasattr(att_in.status, "value") else att_in.status, "note": existing.note})
        db.commit()
        db.refresh(existing)
        return existing

    entry = models.Attendance(
        student_id=att_in.student_id,
        class_id=att_in.class_id,
        teacher_id=current_user.id,
        subject=att_in.subject,
        date=att_in.date,
        status=att_in.status,
        note=att_in.note,
    )
    db.add(entry)
    db.flush()
    log_action(db, current_user, "create", "attendance", entry.id, f"Отмечена посещаемость ученика #{entry.student_id}",
               after={"status": att_in.status.value if hasattr(att_in.status, "value") else att_in.status, "subject": entry.subject, "date": entry.date})
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/attendance/student/{student_id}", response_model=List[schemas.AttendanceOut])
def student_attendance(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Посещаемость ученика — для самого ученика, его родителя, учителя его класса и админа."""
    _assert_can_view_student(db, current_user, student_id)
    return db.query(models.Attendance).filter(
        models.Attendance.student_id == student_id
    ).order_by(models.Attendance.date.desc()).all()


@router.get("/grades/student/{student_id}", response_model=List[schemas.StudentGradeItem])
def student_grades(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Return journal and homework grades without displaying linked homework twice."""
    _assert_can_view_student(db, current_user, student_id)

    items: List[schemas.StudentGradeItem] = []
    linked_submission_ids = set()
    journal_grades = db.query(models.GradeEntry).filter(
        models.GradeEntry.student_id == student_id
    ).all()
    for entry in journal_grades:
        if entry.submission_id is not None:
            linked_submission_ids.add(entry.submission_id)
            submission = db.query(models.Submission).filter(
                models.Submission.id == entry.submission_id
            ).first()
            assignment = submission.assignment if submission else None
            items.append(schemas.StudentGradeItem(
                subject=entry.subject,
                grade=entry.grade,
                date=datetime.combine(entry.date, datetime.min.time()),
                source="assignment" if assignment else "journal",
                label=assignment.title if assignment else (entry.comment or "Оценка в журнале"),
                comment=(submission.teacher_feedback if submission else "") or entry.comment,
            ))
        else:
            items.append(schemas.StudentGradeItem(
                subject=entry.subject,
                grade=entry.grade,
                date=datetime.combine(entry.date, datetime.min.time()),
                source="journal",
                label=entry.comment or "Оценка в журнале",
                comment=entry.comment,
            ))

    submissions = db.query(models.Submission).filter(
        models.Submission.student_id == student_id,
        models.Submission.grade.isnot(None),
        models.Submission.is_submitted.is_(True),
    ).all()
    for submission in submissions:
        if submission.id in linked_submission_ids:
            continue
        assignment = db.query(models.Assignment).filter(
            models.Assignment.id == submission.assignment_id
        ).first()
        if not assignment:
            continue
        items.append(schemas.StudentGradeItem(
            subject=assignment.subject or "Без предмета",
            grade=submission.grade,
            # Use the assignment issue date when a grade has no journal row yet.
            date=datetime.combine((assignment.created_at or submission.graded_at or submission.submitted_at or datetime.utcnow()).date(), datetime.min.time()),
            source="assignment",
            label=assignment.title,
            comment=submission.teacher_feedback,
        ))

    items.sort(key=lambda item: item.date, reverse=True)
    return items
