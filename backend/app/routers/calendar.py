from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/calendar", tags=["calendar"])


@router.get("/my")
def my_calendar(
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    start = start_date or date.today()
    end = end_date or start + timedelta(days=30)
    if end < start:
        raise HTTPException(status_code=400, detail="Дата окончания не может быть раньше начала")
    if (end - start).days > 62:
        raise HTTPException(status_code=400, detail="Можно запрашивать не более 63 календарных дней")
    role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role
    if role == "student":
        child_ids = [current_user.id]
        class_ids = [e.class_id for e in db.query(models.Enrollment).filter(
            models.Enrollment.student_id == current_user.id).all()]
    elif role == "parent":
        child_ids = [p.student_id for p in db.query(models.ParentStudent).filter(
            models.ParentStudent.parent_id == current_user.id).all()]
        class_ids = [e.class_id for e in db.query(models.Enrollment).filter(
            models.Enrollment.student_id.in_(child_ids or [-1])).all()]
    elif role == "teacher":
        child_ids = []
        class_ids = [c.id for c in db.query(models.ClassRoom).filter(models.ClassRoom.is_active.is_(True)).all()]
    else:
        child_ids = []
        class_ids = [c.id for c in db.query(models.ClassRoom).filter(models.ClassRoom.is_active.is_(True)).all()]
    class_map = {c.id: c.name for c in db.query(models.ClassRoom).filter(
        models.ClassRoom.id.in_(class_ids or [-1])).all()}
    events = []
    assignments = db.query(models.Assignment).filter(
        models.Assignment.class_id.in_(class_ids or [-1]),
        models.Assignment.deadline >= datetime.combine(start, time.min),
        models.Assignment.deadline <= datetime.combine(end, time.max),
    ).all()
    for item in assignments:
        if not item.is_active:
            continue
        if role == "student" and db.query(models.Submission.id).filter(
            models.Submission.assignment_id == item.id,
            models.Submission.student_id == current_user.id,
        ).first():
            status = "submitted"
        else:
            status = "upcoming" if item.deadline >= datetime.utcnow() else "overdue"
        events.append({"id": f"assignment-{item.id}", "event_type": "assignment",
                       "title": f"Сдать: {item.title}", "subject": item.subject or "",
                       "date": item.deadline.isoformat(), "description": item.description or "",
                       "class_name": class_map.get(item.class_id, ""), "status": status})
    lessons = db.query(models.ScheduleLesson).filter(
        models.ScheduleLesson.class_id.in_(class_ids or [-1])).all()
    if role == "teacher":
        lessons = [l for l in lessons if l.teacher_id == current_user.id or
                   db.query(models.ClassRoom.id).filter(
                       models.ClassRoom.id == l.class_id, models.ClassRoom.teacher_id == current_user.id
                   ).first()]
    day = start
    while day <= end:
        week = day.isocalendar().week
        for lesson in lessons:
            if day.isoweekday() != lesson.day_of_week:
                continue
            week_type = getattr(lesson, "week_type", "all") or "all"
            if week_type == "even" and week % 2:
                continue
            if week_type == "odd" and not week % 2:
                continue
            try:
                h, m = map(int, lesson.start_time.split(":"))
                eh, em = map(int, lesson.end_time.split(":"))
                starts = datetime.combine(day, time(h, m))
                ends = datetime.combine(day, time(eh, em))
            except (ValueError, TypeError):
                continue
            events.append({"id": f"lesson-{lesson.id}-{day.isoformat()}", "event_type": "lesson",
                           "title": lesson.subject, "subject": lesson.subject, "date": starts.isoformat(),
                           "end": ends.isoformat(), "description": lesson.note or "",
                           "class_name": class_map.get(lesson.class_id, ""), "room": lesson.room or "",
                           "week_type": week_type, "status": "scheduled"})
        day += timedelta(days=1)
    return sorted(events, key=lambda item: item["date"])
