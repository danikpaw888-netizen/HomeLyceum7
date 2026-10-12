from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db
from ..events import notify_users

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _create_deadline_reminders(db: Session, user: models.User) -> bool:
    role = user.role.value if hasattr(user.role, "value") else user.role
    if role == "student":
        student_ids = [user.id]
    elif role == "parent":
        student_ids = [row.student_id for row in db.query(models.ParentStudent).filter(
            models.ParentStudent.parent_id == user.id
        ).all()]
    else:
        return False
    if not student_ids:
        return False
    class_ids = [row.class_id for row in db.query(models.Enrollment).filter(
        models.Enrollment.student_id.in_(student_ids)
    ).all()]
    if not class_ids:
        return False
    now, soon = datetime.utcnow(), datetime.utcnow() + timedelta(hours=48)
    assignments = db.query(models.Assignment).filter(
        models.Assignment.class_id.in_(class_ids), models.Assignment.is_active.is_(True),
        models.Assignment.deadline >= now, models.Assignment.deadline <= soon,
    ).all()
    changed = False
    for student_id in student_ids:
        own_classes = [row.class_id for row in db.query(models.Enrollment).filter(
            models.Enrollment.student_id == student_id
        ).all()]
        for assignment in assignments:
            if assignment.class_id not in own_classes:
                continue
            if db.query(models.Submission.id).filter(
                models.Submission.assignment_id == assignment.id,
                models.Submission.student_id == student_id,
            ).first():
                continue
            key = f"deadline:{assignment.id}:{student_id}:{user.id}"
            if db.query(models.Notification.id).filter(
                models.Notification.user_id == user.id,
                models.Notification.dedupe_key == key,
            ).first():
                continue
            notify_users(db, [user.id], "deadline", "Скоро срок сдачи",
                         f"До сдачи задания «{assignment.title}» осталось не более 48 часов.",
                         "/", f"deadline:{assignment.id}:{student_id}")
            changed = True
    return changed


@router.get("/", response_model=List[schemas.NotificationOut])
def list_notifications(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if _create_deadline_reminders(db, current_user):
        db.commit()
    return db.query(models.Notification).filter(
        models.Notification.user_id == current_user.id
    ).order_by(models.Notification.created_at.desc()).limit(100).all()


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return {"count": db.query(models.Notification).filter(
        models.Notification.user_id == current_user.id,
        models.Notification.read_at.is_(None),
    ).count()}


@router.put("/read-all")
def read_all(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db.query(models.Notification).filter(
        models.Notification.user_id == current_user.id,
        models.Notification.read_at.is_(None),
    ).update({"read_at": datetime.utcnow()}, synchronize_session=False)
    db.commit()
    return {"status": "ok"}


@router.put("/{notification_id}/read")
def read_notification(notification_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    item = db.query(models.Notification).filter(
        models.Notification.id == notification_id, models.Notification.user_id == current_user.id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Уведомление не найдено")
    item.read_at = datetime.utcnow()
    db.commit()
    return {"status": "ok"}
