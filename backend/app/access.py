"""Общие правила доступа учителей к журналу.

Учителя видят все активные классы, чтобы новый класс, созданный
администратором, появлялся у них сразу. Право выставлять оценку по
конкретному предмету по-прежнему определяется расписанием класса: учитель
может оценивать свой предмет, а администратор — любой.
"""
from typing import Set

from sqlalchemy.orm import Session

from . import models


def norm_subject(subject: str) -> str:
    return (subject or "").strip().lower()


def role_value(user: models.User) -> str:
    return user.role.value if hasattr(user.role, "value") else user.role


def teacher_class_ids(db: Session, teacher_id: int) -> Set[int]:
    """Активные классы, доступные учителю для работы в журнале.

    Администратор может создать новый класс, не назначив его владельцем
    конкретного учителя. Поэтому активные классы должны быть видны учителям
    сразу после создания. При этом ограничение по предмету для выставления
    оценок по-прежнему контролируется через расписание в can_grade_subject().
    """
    return {c.id for c in db.query(models.ClassRoom).filter(
        models.ClassRoom.is_active.is_(True),
    ).all()}


def teacher_subjects_in_class(db: Session, teacher_id: int, class_id: int) -> Set[str]:
    lessons = db.query(models.ScheduleLesson).filter(
        models.ScheduleLesson.class_id == class_id,
        models.ScheduleLesson.teacher_id == teacher_id,
    ).all()
    return {norm_subject(l.subject) for l in lessons}


def can_grade_subject(db: Session, user: models.User, class_room: models.ClassRoom, subject: str) -> bool:
    role = role_value(user)
    if role == "admin":
        return True
    if role == "teacher":
        if class_room.teacher_id == user.id:
            return True
        return norm_subject(subject) in teacher_subjects_in_class(db, user.id, class_room.id)
    return False
