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
async def submit_homework(
    assignment_id: int, comment: str = Form(""),
    file: Optional[UploadFile] = File(None), files: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db), current_user: models.User = Depends(require_roles("student")),
):
    assignment = db.query(models.Assignment).filter(
        models.Assignment.id == assignment_id, models.Assignment.is_active.is_(True)
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Задание не найдено или оно уже закрыто")
    enrolled = db.query(models.Enrollment).filter(
        models.Enrollment.class_id == assignment.class_id, models.Enrollment.student_id == current_user.id
    ).first()
    if not enrolled:
        raise HTTPException(status_code=403, detail="Вы не состоите в этом классе")

    upload_files = [f for f in (files or []) if f and f.filename]
    if file and file.filename:
        upload_files.append(file)
    uploads = await _save_uploads(upload_files)
    existing = db.query(models.Submission).filter(
        models.Submission.assignment_id == assignment_id, models.Submission.student_id == current_user.id
    ).first()

    if existing:
        if not assignment.allow_resubmission:
            raise HTTPException(status_code=400, detail="Повторная сдача этого задания запрещена")
        max_attempts = max(1, assignment.max_attempts or 1)
        if (existing.attempt_count or 1) >= max_attempts:
            raise HTTPException(status_code=400, detail=f"Достигнут лимит попыток: {max_attempts}")
        old_files = [{"file_path": a.file_path, "original_filename": a.original_filename}
                     for a in existing.attachments if a.is_current]
        db.add(models.SubmissionAttempt(
            submission_id=existing.id, attempt_number=existing.attempt_count or 1,
            file_path=existing.file_path, original_filename=existing.original_filename,
            comment=existing.comment, grade=existing.grade, teacher_feedback=existing.teacher_feedback,
            submitted_at=existing.submitted_at, graded_at=existing.graded_at,
            attachments_json=json.dumps(old_files, ensure_ascii=False),
        ))
        if uploads:
            for attachment in existing.attachments:
                if attachment.is_current:
                    attachment.is_current = False
            for upload in uploads:
                existing.attachments.append(models.SubmissionAttachment(
                    **upload, is_current=True, attempt_number=(existing.attempt_count or 1) + 1))
            existing.file_path, existing.original_filename = uploads[0]["file_path"], uploads[0]["original_filename"]
        before_attempts = existing.attempt_count or 1
        old_grade = existing.grade
        existing.comment = comment
        existing.submitted_at = datetime.utcnow()
        existing.attempt_count = before_attempts + 1
        existing.grade = None
        existing.teacher_feedback = ""
        existing.graded_at = None
        log_action(db, current_user, "resubmit", "submission", existing.id,
                   f"Повторно отправлена работа по заданию «{assignment.title}»",
                   before={"attempt_count": before_attempts, "grade": old_grade},
                   after={"attempt_count": existing.attempt_count, "files": [x["original_filename"] for x in uploads]})
        submission = existing
        message = f"Ученик {current_user.full_name} повторно отправил работу «{assignment.title}»."
    else:
        submission = models.Submission(
            assignment_id=assignment_id, student_id=current_user.id,
            file_path=uploads[0]["file_path"] if uploads else None,
            original_filename=uploads[0]["original_filename"] if uploads else None,
            comment=comment, attempt_count=1)
        db.add(submission)
        db.flush()
        for upload in uploads:
            submission.attachments.append(models.SubmissionAttachment(**upload, is_current=True, attempt_number=1))
        log_action(db, current_user, "create", "submission", submission.id,
                   f"Отправлена работа по заданию «{assignment.title}»",
                   after={"assignment_id": assignment.id, "files": [x["original_filename"] for x in uploads]})
        message = f"Ученик {current_user.full_name} отправил работу «{assignment.title}»."

    notify_users(db, [assignment.teacher_id] if assignment.teacher_id else [],
                 "submission", "Получена работа", message, "/")
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
    return db.query(models.Submission).filter(models.Submission.assignment_id == assignment_id).all()


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
    log_action(db, current_user, "grade", "submission", submission.id,
               f"Поставлена оценка {grade_in.grade}/10 за «{submission.assignment.title}»",
               before=before, after={"grade": submission.grade, "teacher_feedback": submission.teacher_feedback})
    notify_student_and_parents(db, submission.student_id, "grade", "Работа проверена",
                               f"За задание «{submission.assignment.title}» выставлена оценка {submission.grade}/10.", "/")
    db.commit()
    db.refresh(submission)
    return submission
