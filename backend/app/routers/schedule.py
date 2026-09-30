from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user, require_roles
from ..database import get_db

router = APIRouter(prefix="/schedule", tags=["schedule"])


@router.post("/", response_model=schemas.ScheduleLessonOut)
def create_lesson(
    lesson_in: schemas.ScheduleLessonCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
):
    class_room = db.query(models.ClassRoom).filter(models.ClassRoom.id == lesson_in.class_id).first()
    if not class_room:
        raise HTTPException(status_code=404, detail="Класс не найден")

    lesson = models.ScheduleLesson(
        class_id=lesson_in.class_id,
        subject=lesson_in.subject,
        teacher_id=lesson_in.teacher_id,
        day_of_week=lesson_in.day_of_week,
        start_time=lesson_in.start_time,
        end_time=lesson_in.end_time,
        room=lesson_in.room,
        note=lesson_in.note,
        week_type=lesson_in.week_type,
        created_by=current_user.id,
    )
    db.add(lesson)
    db.commit()
    db.refresh(lesson)
    return lesson


@router.put("/{lesson_id}", response_model=schemas.ScheduleLessonOut)
def update_lesson(
    lesson_id: int,
    lesson_in: schemas.ScheduleLessonCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_roles("admin")),
):
    lesson = db.query(models.ScheduleLesson).filter(models.ScheduleLesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Урок не найден")

    for field, value in lesson_in.model_dump().items():
        setattr(lesson, field, value)
    db.commit()
    db.refresh(lesson)
    return lesson


@router.delete("/{lesson_id}")
def delete_lesson(
    lesson_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_roles("admin")),
):
    lesson = db.query(models.ScheduleLesson).filter(models.ScheduleLesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Урок не найден")
    db.delete(lesson)
    db.commit()
    return {"status": "ok"}


@router.get("/class/{class_id}", response_model=List[schemas.ScheduleLessonOut])
def lessons_for_class(
    class_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    return db.query(models.ScheduleLesson).filter(models.ScheduleLesson.class_id == class_id).order_by(
        models.ScheduleLesson.day_of_week, models.ScheduleLesson.start_time
    ).all()


@router.get("/my", response_model=List[schemas.ScheduleLessonOut])
def my_schedule(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """Расписание, актуальное для текущего пользователя, в зависимости от роли."""
    role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role

    if role == "student":
        class_ids = [e.class_id for e in
                     db.query(models.Enrollment).filter(models.Enrollment.student_id == current_user.id).all()]
    elif role == "teacher":
        class_ids = [c.id for c in
                     db.query(models.ClassRoom).filter(models.ClassRoom.teacher_id == current_user.id).all()]
    elif role == "parent":
        child_ids = [ps.student_id for ps in
                     db.query(models.ParentStudent).filter(models.ParentStudent.parent_id == current_user.id).all()]
        class_ids = [e.class_id for e in
                     db.query(models.Enrollment).filter(models.Enrollment.student_id.in_(child_ids)).all()]
    else:  # admin видит только активные классы; история удалённых классов сохраняется в БД
        class_ids = [c.id for c in db.query(models.ClassRoom).filter(models.ClassRoom.is_active.is_(True)).all()]

    return db.query(models.ScheduleLesson).filter(models.ScheduleLesson.class_id.in_(class_ids)).order_by(
        models.ScheduleLesson.day_of_week, models.ScheduleLesson.start_time
    ).all()
