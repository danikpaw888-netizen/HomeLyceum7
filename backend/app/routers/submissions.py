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

router = APIRouter(prefix="/submissions", tags=["submissions"])

ALLOWED_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".txt", ".jpg", ".jpeg", ".png", ".heic",
    ".zip", ".rar", ".xlsx", ".pptx",
}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 МБ


@router.post("/{assignment_id}", response_model=schemas.SubmissionOut)
async def submit_homework(
    assignment_id: int,
    comment: str = Form(""),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("student")),
):
    assignment = db.query(models.Assignment).filter(models.Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Задание не найдено")

    # ученик должен состоять в классе задания
    enrolled = db.query(models.Enrollment).filter(
        models.Enrollment.class_id == assignment.class_id,
        models.Enrollment.student_id == current_user.id,
    ).first()
    if not enrolled:
        raise HTTPException(status_code=403, detail="Вы не состоите в этом классе")

    file_path = None
    original_filename = None

    if file is not None:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"Недопустимый тип файла: {ext}")

        contents = await file.read()
        if len(contents) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="Файл слишком большой (макс. 20 МБ)")

        stored_name = f"{uuid.uuid4().hex}{ext}"
        disk_path = os.path.join(settings.UPLOAD_DIR, stored_name)
        with open(disk_path, "wb") as f:
            f.write(contents)

        file_path = f"/{settings.UPLOAD_DIR}/{stored_name}"
        original_filename = file.filename

    existing = db.query(models.Submission).filter(
        models.Submission.assignment_id == assignment_id,
        models.Submission.student_id == current_user.id,
    ).first()

    if existing:
        # переотправка — обновляем существующую сдачу
        if file_path:
            existing.file_path = file_path
            existing.original_filename = original_filename
        existing.comment = comment
        existing.submitted_at = datetime.utcnow()
        existing.grade = None
        existing.teacher_feedback = ""
        existing.graded_at = None
        db.commit()
        db.refresh(existing)
        return existing

    submission = models.Submission(
        assignment_id=assignment_id,
        student_id=current_user.id,
        file_path=file_path,
        original_filename=original_filename,
        comment=comment,
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)
    return submission


@router.get("/assignment/{assignment_id}", response_model=List[schemas.SubmissionOut])
def list_submissions_for_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_roles("teacher", "admin")),
):
    return db.query(models.Submission).filter(models.Submission.assignment_id == assignment_id).all()


@router.get("/my", response_model=List[schemas.SubmissionOut])
def my_submissions(db: Session = Depends(get_db), current_user: models.User = Depends(require_roles("student"))):
    return db.query(models.Submission).filter(models.Submission.student_id == current_user.id).all()


@router.get("/child/{student_id}", response_model=List[schemas.SubmissionOut])
def child_submissions(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("parent")),
):
    link = db.query(models.ParentStudent).filter(
        models.ParentStudent.parent_id == current_user.id,
        models.ParentStudent.student_id == student_id,
    ).first()
    if not link:
        raise HTTPException(status_code=403, detail="Это не ваш ребёнок")
    return db.query(models.Submission).filter(models.Submission.student_id == student_id).all()


@router.put("/{submission_id}/grade", response_model=schemas.SubmissionOut)
def grade_submission(
    submission_id: int,
    grade_in: schemas.GradeIn,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_roles("teacher", "admin")),
):
    submission = db.query(models.Submission).filter(models.Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Работа не найдена")

    if not (1 <= grade_in.grade <= 10):
        raise HTTPException(status_code=400, detail="Оценка должна быть от 1 до 10")

    submission.grade = grade_in.grade
    submission.teacher_feedback = grade_in.teacher_feedback
    submission.graded_at = datetime.utcnow()
    db.commit()
    db.refresh(submission)
    return submission
