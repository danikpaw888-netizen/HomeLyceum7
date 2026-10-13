import os
import uuid
from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user, require_roles
from ..config import settings
from ..database import get_db
from ..events import log_action

router = APIRouter(prefix="/homeschool", tags=["homeschool"])

ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png"}
MAX_FILE_SIZE = 20 * 1024 * 1024


def save_upload(file: UploadFile):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Недопустимый тип файла: {ext}")
    return ext


@router.post("/", response_model=schemas.HomeschoolOut)
def create_record(
    student_id: int = Form(...),
    reason: str = Form(...),
    start_date: date = Form(...),
    notes: str = Form(""),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
):
    student = db.query(models.User).filter(
        models.User.id == student_id, models.User.role == models.Role.student,
        models.User.approval_status == "approved"
    ).first()
    if not student:
        raise HTTPException(status_code=404, detail="Ученик не найден")

    already_active = db.query(models.HomeschoolRecord).filter(
        models.HomeschoolRecord.student_id == student_id,
        models.HomeschoolRecord.end_date.is_(None),
    ).first()
    if already_active:
        raise HTTPException(status_code=400, detail="У ученика уже есть активный перевод на домашнее обучение")

    record = models.HomeschoolRecord(
        student_id=student_id,
        reason=reason,
        start_date=start_date,
        notes=notes,
        created_by=current_user.id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.post("/{record_id}/documents", response_model=schemas.HomeschoolDocumentOut)
async def add_document(
    record_id: int,
    document_type: str = Form(...),
    title: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
):
    record = db.query(models.HomeschoolRecord).filter(models.HomeschoolRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Запись домашнего обучения не найдена")

    ext = save_upload(file)
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Файл слишком большой (макс. 20 МБ)")

    stored_name = f"{uuid.uuid4().hex}{ext}"
    disk_path = os.path.join(settings.UPLOAD_DIR, stored_name)
    with open(disk_path, "wb") as f:
        f.write(contents)

    doc = models.HomeschoolDocument(
        record_id=record_id,
        document_type=document_type,
        title=title,
        file_path=f"/uploads/{stored_name}",
        original_filename=file.filename or stored_name,
        uploaded_by=current_user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc



@router.delete("/{record_id}/documents/{document_id}")
def delete_document(
    record_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
):
    """Удаляет вложение из дела домашнего обучения, не удаляя само дело или историю ученика."""
    record = db.query(models.HomeschoolRecord).filter(
        models.HomeschoolRecord.id == record_id
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Запись домашнего обучения не найдена")

    document = db.query(models.HomeschoolDocument).filter(
        models.HomeschoolDocument.id == document_id,
        models.HomeschoolDocument.record_id == record_id,
    ).first()
    if not document:
        raise HTTPException(status_code=404, detail="Документ не найден в этом деле")

    stored_path = document.file_path
    original_filename = document.original_filename
    document_title = document.title
    # Only remove the physical file when no other known row references the same path.
    other_homeschool_reference = db.query(models.HomeschoolDocument.id).filter(
        models.HomeschoolDocument.file_path == stored_path,
        models.HomeschoolDocument.id != document.id,
    ).first()
    other_assignment_reference = db.query(models.Assignment.id).filter(
        models.Assignment.file_path == stored_path
    ).first()
    other_submission_reference = db.query(models.Submission.id).filter(
        models.Submission.file_path == stored_path
    ).first()
    log_action(
        db, current_user, "delete_document", "homeschool_document", document.id,
        f"Удалено вложение «{document_title}» из дела домашнего обучения #{record_id}",
        before={"record_id": record_id, "title": document_title, "original_filename": original_filename,
                "file_path": stored_path},
        after={"deleted": True, "record_preserved": True},
    )
    db.delete(document)
    db.commit()

    if not (other_homeschool_reference or other_assignment_reference or other_submission_reference):
        upload_root = os.path.realpath(settings.UPLOAD_DIR)
        stored_name = os.path.basename((stored_path or "").replace("\\\\", "/"))
        if stored_name not in ("", ".", ".."):
            disk_path = os.path.realpath(os.path.join(upload_root, stored_name))
            if os.path.commonpath([upload_root, disk_path]) == upload_root and os.path.isfile(disk_path):
                try:
                    os.remove(disk_path)
                except OSError:
                    # The DB reference is already removed; keep the endpoint idempotent.
                    pass

    return {"status": "ok", "deleted_id": document_id, "message": "Документ удалён из дела."}


@router.get("/admin/all", response_model=List[schemas.HomeschoolOut])
def all_records(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_roles("admin")),
):
    return db.query(models.HomeschoolRecord).order_by(
        models.HomeschoolRecord.start_date.desc()
    ).all()


@router.put("/{record_id}/close", response_model=schemas.HomeschoolOut)
def close_record(
    record_id: int,
    close_in: schemas.HomeschoolCloseIn,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_roles("admin")),
):
    record = db.query(models.HomeschoolRecord).filter(models.HomeschoolRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    if record.end_date is not None:
        raise HTTPException(status_code=400, detail="Эта запись уже закрыта")
    if close_in.end_date < record.start_date:
        raise HTTPException(status_code=400, detail="Дата возврата не может быть раньше даты начала")

    record.end_date = close_in.end_date
    record.topics_covered = close_in.topics_covered
    record.notes = close_in.notes
    db.commit()
    db.refresh(record)
    return record


@router.get("/student/{student_id}", response_model=List[schemas.HomeschoolOut])
def student_records(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role

    if role not in ("admin", "student", "parent"):
        raise HTTPException(status_code=403, detail="Нет доступа к документам домашнего обучения")

    if role == "student" and current_user.id != student_id:
        raise HTTPException(status_code=403, detail="Нет доступа")

    if role == "parent":
        link = db.query(models.ParentStudent).filter(
            models.ParentStudent.parent_id == current_user.id,
            models.ParentStudent.student_id == student_id,
        ).first()
        if not link:
            raise HTTPException(status_code=403, detail="Это не ваш ребёнок")

    return db.query(models.HomeschoolRecord).filter(
        models.HomeschoolRecord.student_id == student_id
    ).order_by(models.HomeschoolRecord.start_date.desc()).all()
