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

router = APIRouter(prefix="/assignments", tags=["assignments"])

ALLOWED_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".txt", ".jpg", ".jpeg", ".png", ".heic",
    ".zip", ".rar", ".xlsx", ".pptx",
}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 МБ


@router.post("/", response_model=schemas.AssignmentOut)
async def create_assignment(
    class_id: int = Form(...),
    subject: str = Form(""),
    title: str = Form(...),
    description: str = Form(""),
    deadline: datetime = Form(...),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    class_room = db.query(models.ClassRoom).filter(models.ClassRoom.id == class_id).first()
    if not class_room:
        raise HTTPException(status_code=404, detail="Класс не найден")

    file_path = None
    original_filename = None

    if file is not None and file.filename:
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

    assignment = models.Assignment(
        class_id=class_id,
        teacher_id=current_user.id,
        subject=subject,
        title=title,
        description=description,
        deadline=deadline,
        file_path=file_path,
        original_filename=original_filename,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment


@router.get("/class/{class_id}", response_model=List[schemas.AssignmentOut])
def list_class_assignments(
    class_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    return db.query(models.Assignment).filter(models.Assignment.class_id == class_id).order_by(
        models.Assignment.deadline
    ).all()


@router.get("/{assignment_id}", response_model=schemas.AssignmentOut)
def get_assignment(assignment_id: int, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    assignment = db.query(models.Assignment).filter(models.Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Задание не найдено")
    return assignment


@router.get("/my/feed", response_model=List[schemas.AssignmentOut])
def my_feed(db: Session = Depends(get_db), current_user: models.User = Depends(require_roles("student"))):
    """Все задания по классам, в которых состоит ученик — как лента в Classroom."""
    class_ids = [e.class_id for e in
                 db.query(models.Enrollment).filter(models.Enrollment.student_id == current_user.id).all()]
    return db.query(models.Assignment).filter(models.Assignment.class_id.in_(class_ids)).order_by(
        models.Assignment.deadline
    ).all()
