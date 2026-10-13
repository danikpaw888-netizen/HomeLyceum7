import os
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user, require_roles
from ..config import settings
from ..database import get_db
from ..events import log_action, notify_users
from ..access import norm_subject, teacher_subjects_in_class

router = APIRouter(prefix="/assignments", tags=["assignments"])
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".txt", ".jpg", ".jpeg", ".png", ".heic", ".zip", ".rar", ".xlsx", ".xls", ".ppt", ".pptx"}
MAX_FILE_SIZE = 20 * 1024 * 1024
MAX_FILES = 10


def _normalize_assignment_datetime(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _incoming(files: Optional[List[UploadFile]], file: Optional[UploadFile]) -> List[UploadFile]:
    result = [item for item in (files or []) if item and item.filename]
    if file and file.filename:
        result.append(file)
    return result


async def _save_uploads(upload_files: List[UploadFile]) -> List[dict]:
    if len(upload_files) > MAX_FILES:
        raise HTTPException(status_code=400, detail="Можно прикрепить не более 10 файлов")
    buffered = []
    for upload in upload_files:
        ext = os.path.splitext(upload.filename or "")[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"Недопустимый тип файла: {ext or 'без расширения'}")
        contents = await upload.read()
        if len(contents) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail=f"Файл «{upload.filename}» превышает 20 МБ")
        buffered.append((upload.filename, ext, contents))
    saved = []
    for filename, ext, contents in buffered:
        stored = f"{uuid.uuid4().hex}{ext}"
        with open(os.path.join(settings.UPLOAD_DIR, stored), "wb") as stream:
            stream.write(contents)
        saved.append({"file_path": f"/uploads/{stored}", "original_filename": filename})
    return saved


def _owned_or_admin(assignment: models.Assignment, user: models.User) -> None:
    role = user.role.value if hasattr(user.role, "value") else user.role
    if role != "admin" and assignment.teacher_id != user.id:
        raise HTTPException(status_code=403, detail="Редактировать задание может только создавший его учитель")


def _require_teacher_subject(db: Session, user: models.User, class_id: int, subject: str) -> None:
    role = user.role.value if hasattr(user.role, "value") else user.role
    if role != "teacher":
        return
    subject_key = norm_subject(subject)
    if not subject_key:
        raise HTTPException(status_code=400, detail="Выберите предмет из своего расписания")
    if subject_key not in teacher_subjects_in_class(db, user.id, class_id):
        raise HTTPException(
            status_code=403,
            detail="Выдавать задания можно только по предметам, назначенным вам в расписании выбранного класса",
        )


@router.post("/", response_model=schemas.AssignmentOut)
async def create_assignment(
    class_id: int = Form(...), subject: str = Form(""), title: str = Form(...),
    description: str = Form(""), deadline: datetime = Form(...),
    created_at: Optional[datetime] = Form(None),
    allow_resubmission: bool = Form(True), max_attempts: int = Form(3),
    file: Optional[UploadFile] = File(None), files: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    class_room = db.query(models.ClassRoom).filter(
        models.ClassRoom.id == class_id, models.ClassRoom.is_active.is_(True)
    ).first()
    if not class_room:
        raise HTTPException(status_code=404, detail="Активный класс не найден")
    if not title.strip():
        raise HTTPException(status_code=400, detail="Название задания не может быть пустым")
    if not 1 <= max_attempts <= 20:
        raise HTTPException(status_code=400, detail="Число попыток должно быть от 1 до 20")
    _require_teacher_subject(db, current_user, class_id, subject)
    uploads = await _save_uploads(_incoming(files, file))
    issue_date = _normalize_assignment_datetime(created_at) or datetime.utcnow()
    assignment = models.Assignment(
        class_id=class_id, teacher_id=current_user.id, subject=subject.strip(), title=title.strip(),
        description=description.strip(), deadline=deadline, created_at=issue_date,
        allow_resubmission=allow_resubmission,
        max_attempts=max_attempts if allow_resubmission else 1,
        file_path=uploads[0]["file_path"] if uploads else None,
        original_filename=uploads[0]["original_filename"] if uploads else None, is_active=True,
    )
    db.add(assignment)
    db.flush()
    for item in uploads:
        assignment.attachments.append(models.AssignmentAttachment(**item, is_active=True))
    student_ids = [e.student_id for e in db.query(models.Enrollment).filter(
        models.Enrollment.class_id == class_id).all()]
    parent_ids = [p.parent_id for p in db.query(models.ParentStudent).filter(
        models.ParentStudent.student_id.in_(student_ids or [-1])).all()]
    notify_users(db, [*student_ids, *parent_ids], "assignment", "Новое задание",
                 f"{assignment.subject + ': ' if assignment.subject else ''}{assignment.title}", "/")
    log_action(db, current_user, "create", "assignment", assignment.id,
               f"Создано задание «{assignment.title}» для класса {class_room.name}",
               after={"title": assignment.title, "class_id": class_id, "subject": assignment.subject,
                      "deadline": deadline, "files": [x["original_filename"] for x in uploads]})
    db.commit()
    db.refresh(assignment)
    return assignment


@router.get("/class/{class_id}", response_model=List[schemas.AssignmentOut])
def list_class_assignments(class_id: int, db: Session = Depends(get_db),
                           _: models.User = Depends(require_roles("teacher", "admin"))):
    return db.query(models.Assignment).filter(
        models.Assignment.class_id == class_id, models.Assignment.is_active.is_(True)
    ).order_by(models.Assignment.deadline).all()


@router.get("/my/feed", response_model=List[schemas.AssignmentOut])
def my_feed(db: Session = Depends(get_db), current_user: models.User = Depends(require_roles("student"))):
    class_ids = [e.class_id for e in db.query(models.Enrollment).filter(
        models.Enrollment.student_id == current_user.id).all()]
    if not class_ids:
        return []
    return db.query(models.Assignment).filter(
        models.Assignment.class_id.in_(class_ids), models.Assignment.is_active.is_(True)
    ).order_by(models.Assignment.deadline).all()



@router.get("/admin/all")
def admin_all_assignments(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_roles("admin")),
):
    """Admin oversight: all assignments, including archived/soft-deleted tasks."""
    items = db.query(models.Assignment).order_by(
        models.Assignment.created_at.desc(), models.Assignment.id.desc()
    ).all()
    result = []
    for assignment in items:
        class_room = db.query(models.ClassRoom).filter(
            models.ClassRoom.id == assignment.class_id
        ).first()
        teacher = db.query(models.User).filter(
            models.User.id == assignment.teacher_id
        ).first()
        active_attachments = [
            {
                "id": attachment.id,
                "file_path": attachment.file_path,
                "original_filename": attachment.original_filename,
            }
            for attachment in assignment.attachments
            if attachment.is_active
        ]
        if not active_attachments and assignment.file_path:
            active_attachments = [{
                "id": None,
                "file_path": assignment.file_path,
                "original_filename": assignment.original_filename or "Материал от учителя",
            }]
        result.append({
            "id": assignment.id,
            "class_id": assignment.class_id,
            "class_name": class_room.name if class_room else "Архивный класс",
            "class_is_active": bool(class_room and class_room.is_active),
            "teacher_id": assignment.teacher_id,
            "teacher_name": teacher.full_name if teacher else "Неизвестный учитель",
            "teacher_email": teacher.email if teacher else "",
            "subject": assignment.subject or "",
            "title": assignment.title,
            "description": assignment.description or "",
            "deadline": assignment.deadline,
            "created_at": assignment.created_at,
            "is_active": bool(assignment.is_active),
            "deleted_at": assignment.deleted_at,
            "allow_resubmission": bool(assignment.allow_resubmission),
            "max_attempts": assignment.max_attempts or 1,
            "attachments": active_attachments,
            "submissions_count": len(assignment.submissions),
        })
    return result



@router.post("/{assignment_id}/attachments/{attachment_id}/replace")
async def replace_assignment_attachment(
    assignment_id: int,
    attachment_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
):
    """Admin can repair stale attachment metadata by uploading a replacement file."""
    assignment = db.query(models.Assignment).filter(
        models.Assignment.id == assignment_id
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Задание не найдено")

    attachment = None
    if attachment_id:
        attachment = db.query(models.AssignmentAttachment).filter(
            models.AssignmentAttachment.id == attachment_id,
            models.AssignmentAttachment.assignment_id == assignment_id,
        ).first()
        if not attachment:
            raise HTTPException(status_code=404, detail="Вложение не найдено в этом задании")

    uploads = await _save_uploads([file])
    if not uploads:
        raise HTTPException(status_code=400, detail="Выбери файл для загрузки")
    new_file = uploads[0]

    if attachment:
        old_path = attachment.file_path
        old_name = attachment.original_filename
        attachment.file_path = new_file["file_path"]
        attachment.original_filename = new_file["original_filename"]
        attachment.is_active = True
    else:
        # Legacy assignments may only have the original file_path columns.
        old_path = assignment.file_path
        old_name = assignment.original_filename
        attachment = models.AssignmentAttachment(
            assignment_id=assignment.id,
            file_path=new_file["file_path"],
            original_filename=new_file["original_filename"],
            is_active=True,
        )
        db.add(attachment)
        db.flush()

    if not assignment.file_path or assignment.file_path == old_path:
        assignment.file_path = new_file["file_path"]
        assignment.original_filename = new_file["original_filename"]

    log_action(
        db, current_user, "replace_attachment", "assignment_attachment", attachment.id,
        f"Администратор заменил вложение задания «{assignment.title}»",
        before={"file_path": old_path, "original_filename": old_name},
        after={"file_path": new_file["file_path"], "original_filename": new_file["original_filename"],
               "assignment_id": assignment.id},
    )
    db.commit()
    db.refresh(attachment)
    return {
        "id": attachment.id,
        "assignment_id": assignment.id,
        "file_path": attachment.file_path,
        "original_filename": attachment.original_filename,
        "is_active": attachment.is_active,
    }


@router.get("/{assignment_id}", response_model=schemas.AssignmentOut)
def get_assignment(assignment_id: int, db: Session = Depends(get_db),
                   _: models.User = Depends(get_current_user)):
    item = db.query(models.Assignment).filter(
        models.Assignment.id == assignment_id, models.Assignment.is_active.is_(True)
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Задание не найдено")
    return item


@router.put("/{assignment_id}", response_model=schemas.AssignmentOut)
async def update_assignment(
    assignment_id: int, title: str = Form(...), subject: str = Form(""),
    description: str = Form(""), deadline: datetime = Form(...),
    created_at: Optional[datetime] = Form(None),
    allow_resubmission: bool = Form(True), max_attempts: int = Form(3),
    keep_attachment_ids: str = Form("preserve"),
    file: Optional[UploadFile] = File(None), files: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    item = db.query(models.Assignment).filter(
        models.Assignment.id == assignment_id, models.Assignment.is_active.is_(True)
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Задание не найдено")
    _owned_or_admin(item, current_user)
    if not title.strip():
        raise HTTPException(status_code=400, detail="Название задания не может быть пустым")
    if not 1 <= max_attempts <= 20:
        raise HTTPException(status_code=400, detail="Число попыток должно быть от 1 до 20")
    _require_teacher_subject(db, current_user, item.class_id, subject)

    before = {"title": item.title, "subject": item.subject, "description": item.description,
              "deadline": item.deadline, "created_at": item.created_at,
              "allow_resubmission": item.allow_resubmission, "max_attempts": item.max_attempts}
    current = [a for a in item.attachments if a.is_active]
    if keep_attachment_ids == "preserve":
        keep_ids = {a.id for a in current}
    elif keep_attachment_ids.strip() in ("", "none"):
        keep_ids = set()
    else:
        keep_ids = set()
        for raw in keep_attachment_ids.split(","):
            try:
                keep_ids.add(int(raw))
            except ValueError:
                continue
    retained = [a for a in current if a.id in keep_ids]
    uploads = await _save_uploads(_incoming(files, file))
    if len(retained) + len(uploads) > MAX_FILES:
        raise HTTPException(status_code=400, detail="В задании может быть не более 10 активных файлов")
    for attachment in current:
        if attachment.id not in keep_ids:
            attachment.is_active = False
    item.subject = subject.strip()
    item.title = title.strip()
    item.description = description.strip()
    item.deadline = deadline
    if created_at is not None:
        item.created_at = _normalize_assignment_datetime(created_at)
    item.allow_resubmission = allow_resubmission
    item.max_attempts = max_attempts if allow_resubmission else 1
    for upload in uploads:
        item.attachments.append(models.AssignmentAttachment(**upload, is_active=True))
    active_after = retained + [a for a in item.attachments if a.is_active and a.id is None]
    if retained:
        first = retained[0]
        item.file_path, item.original_filename = first.file_path, first.original_filename
    elif uploads:
        item.file_path, item.original_filename = uploads[0]["file_path"], uploads[0]["original_filename"]
    else:
        item.file_path, item.original_filename = None, None
    log_action(db, current_user, "update", "assignment", item.id, f"Изменено задание «{item.title}»",
               before=before, after={"title": item.title, "subject": item.subject, "description": item.description,
                                     "deadline": deadline, "created_at": item.created_at,
                                     "allow_resubmission": allow_resubmission,
                                     "max_attempts": item.max_attempts,
                                     "new_files": [x["original_filename"] for x in uploads]})
    students = [e.student_id for e in db.query(models.Enrollment).filter(
        models.Enrollment.class_id == item.class_id).all()]
    parent_ids = [p.parent_id for p in db.query(models.ParentStudent).filter(
        models.ParentStudent.student_id.in_(students or [-1])).all()]
    notify_users(db, [*students, *parent_ids], "assignment_updated", "Задание изменено",
                 f"Учитель обновил задание «{item.title}». Проверьте условия и срок сдачи.", "/")
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{assignment_id}")
def delete_assignment(assignment_id: int, db: Session = Depends(get_db),
                      current_user: models.User = Depends(require_roles("teacher", "admin"))):
    item = db.query(models.Assignment).filter(
        models.Assignment.id == assignment_id, models.Assignment.is_active.is_(True)
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Задание не найдено")
    _owned_or_admin(item, current_user)
    item.is_active = False
    item.deleted_at = datetime.utcnow()
    log_action(db, current_user, "soft_delete", "assignment", item.id,
               f"Задание «{item.title}» скрыто; сдачи и история сохранены",
               before={"is_active": True}, after={"is_active": False, "deleted_at": item.deleted_at})
    db.commit()
    return {"status": "ok", "message": "Задание удалено из активного списка. История работ сохранена."}
