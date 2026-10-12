"""Общие помощники для уведомлений и журнала действий."""
import json
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from . import models


def notify_users(db: Session, user_ids: Iterable[int], notification_type: str, title: str,
                 message: str, link: Optional[str] = None, dedupe_key: Optional[str] = None) -> None:
    for user_id in set(user_ids or []):
        if not user_id:
            continue
        key = f"{dedupe_key}:{user_id}" if dedupe_key else None
        if key and db.query(models.Notification.id).filter(models.Notification.dedupe_key == key).first():
            continue
        db.add(models.Notification(user_id=user_id, notification_type=notification_type,
                                   title=title, message=message, link=link, dedupe_key=key))


def notify_student_and_parents(db: Session, student_id: int, notification_type: str,
                               title: str, message: str, link: Optional[str] = None) -> None:
    parent_ids = [row.parent_id for row in db.query(models.ParentStudent).filter(
        models.ParentStudent.student_id == student_id
    ).all()]
    notify_users(db, [student_id, *parent_ids], notification_type, title, message, link)


def log_action(db: Session, actor: Optional[models.User], action: str, entity_type: str,
               entity_id: Optional[int], details: str = "", before=None, after=None) -> None:
    def encoded(value):
        return None if value is None else json.dumps(value, ensure_ascii=False, default=str)
    db.add(models.AuditLog(actor_id=actor.id if actor else None,
                           actor_name=actor.full_name if actor else "Система",
                           action=action, entity_type=entity_type, entity_id=entity_id,
                           details=details, before_json=encoded(before), after_json=encoded(after)))
