from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user, require_roles
from ..database import get_db
from ..access import teacher_class_ids

router = APIRouter(prefix="/classes", tags=["classes"])


def _role(user: models.User) -> str:
    return user.role.value if hasattr(user.role, "value") else user.role


def _ensure_active_class(class_room: models.ClassRoom):
    if not class_room.is_active:
        raise HTTPException(status_code=400, detail="Класс находится в архиве и не может использоваться для новых учебных операций")


def _open_history(db: Session, student_id: int, class_room: models.ClassRoom):
    existing = db.query(models.StudentClassHistory).filter(
        models.StudentClassHistory.student_id == student_id,
        models.StudentClassHistory.class_id == class_room.id,
        models.StudentClassHistory.left_at.is_(None),
    ).first()
    if not existing:
        db.add(models.StudentClassHistory(
            student_id=student_id,
            class_id=class_room.id,
            class_name=class_room.name,
            joined_at=datetime.utcnow(),
        ))


def _close_history(db: Session, student_id: int, class_id: int, class_name: str):
    current = db.query(models.StudentClassHistory).filter(
        models.StudentClassHistory.student_id == student_id,
        models.StudentClassHistory.class_id == class_id,
        models.StudentClassHistory.left_at.is_(None),
    ).order_by(models.StudentClassHistory.joined_at.desc()).first()
    now = datetime.utcnow()
    if current:
        current.left_at = now
        # Зафиксировать название на момент выхода из класса.
        current.class_name = class_name
    else:
        db.add(models.StudentClassHistory(
            student_id=student_id,
            class_id=class_id,
            class_name=class_name,
            joined_at=now,
            left_at=now,
        ))


def _student_history_payload(db: Session, student_id: int):
    rows = db.query(models.StudentClassHistory).filter(
        models.StudentClassHistory.student_id == student_id
    ).order_by(
        models.StudentClassHistory.joined_at.desc(),
        models.StudentClassHistory.id.desc(),
    ).all()

    payload = []
    for row in rows:
        grades_count = db.query(models.GradeEntry).filter(
            models.GradeEntry.student_id == student_id,
            models.GradeEntry.class_id == row.class_id,
        ).count()
        attendance_count = db.query(models.Attendance).filter(
            models.Attendance.student_id == student_id,
            models.Attendance.class_id == row.class_id,
        ).count()
        payload.append({
            "id": row.id,
            "student_id": row.student_id,
            "class_id": row.class_id,
            "class_name": row.class_name,
            "joined_at": row.joined_at,
            "left_at": row.left_at,
            "grades_count": grades_count,
            "attendance_count": attendance_count,
        })
    return payload


@router.post("/", response_model=schemas.ClassOut)
def create_class(
    class_in: schemas.ClassCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    name = class_in.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Название класса не может быть пустым")
    active_duplicate = db.query(models.ClassRoom).filter(
        models.ClassRoom.name == name,
        models.ClassRoom.is_active.is_(True),
    ).first()
    if active_duplicate:
        raise HTTPException(status_code=400, detail="Активный класс с таким названием уже существует")

    class_room = models.ClassRoom(name=name, teacher_id=current_user.id, is_active=True)
    db.add(class_room)
    db.commit()
    db.refresh(class_room)
    return class_room


@router.get("/", response_model=List[schemas.ClassOut])
def list_classes(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    role = _role(current_user)
    base = db.query(models.ClassRoom).filter(models.ClassRoom.is_active.is_(True))
    if role == "teacher":
        # Администратор может создавать классы без назначения конкретного учителя.
        # Все активные классы должны быть доступны учителю в списке классов.
        ids = teacher_class_ids(db, current_user.id)
        if not ids:
            return []
        return base.filter(models.ClassRoom.id.in_(ids)).order_by(models.ClassRoom.name).all()
    if role == "student":
        class_ids = [e.class_id for e in
                     db.query(models.Enrollment).filter(models.Enrollment.student_id == current_user.id).all()]
        return base.filter(models.ClassRoom.id.in_(class_ids)).all()
    if role == "parent":
        child_ids = [ps.student_id for ps in
                     db.query(models.ParentStudent).filter(models.ParentStudent.parent_id == current_user.id).all()]
        class_ids = [e.class_id for e in
                     db.query(models.Enrollment).filter(models.Enrollment.student_id.in_(child_ids)).all()]
        return base.filter(models.ClassRoom.id.in_(class_ids)).all()
    return base.all()


@router.put("/{class_id}", response_model=schemas.ClassOut)
def update_class(
    class_id: int,
    class_in: schemas.ClassCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_roles("admin")),
):
    name = class_in.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Название класса не может быть пустым")
    if len(name) > 10:
        raise HTTPException(status_code=400, detail="Название класса не должно превышать 10 символов")

    class_room = db.query(models.ClassRoom).filter(models.ClassRoom.id == class_id).first()
    if not class_room:
        raise HTTPException(status_code=404, detail="Класс не найден")
    _ensure_active_class(class_room)

    duplicate = db.query(models.ClassRoom).filter(
        models.ClassRoom.id != class_id,
        models.ClassRoom.name == name,
        models.ClassRoom.is_active.is_(True),
    ).first()
    if duplicate:
        raise HTTPException(status_code=400, detail="Активный класс с таким названием уже существует")

    class_room.name = name
    # Для ученика, который всё ещё учится в этом классе, текущий период
    # истории отражает новое название; закрытые периоды не переписываем.
    db.query(models.StudentClassHistory).filter(
        models.StudentClassHistory.class_id == class_id,
        models.StudentClassHistory.left_at.is_(None),
    ).update({models.StudentClassHistory.class_name: name}, synchronize_session=False)
    db.commit()
    db.refresh(class_room)
    return class_room


@router.delete("/{class_id}")
def delete_class(
    class_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
):
    """Архивировать класс без удаления учебной истории.

    Оценки, посещаемость, задания, расписание и файлы не удаляются.
    Активные зачисления закрываются и попадают в историю классов учеников.
    Сам класс исчезает из активных списков и может считаться удалённым из текущей структуры школы.
    """
    class_room = db.query(models.ClassRoom).filter(models.ClassRoom.id == class_id).first()
    if not class_room:
        raise HTTPException(status_code=404, detail="Класс не найден")
    if not class_room.is_active:
        return {"status": "ok", "archived": True, "deleted_id": class_id}

    enrollments = db.query(models.Enrollment).filter(
        models.Enrollment.class_id == class_id
    ).all()
    for enrollment in enrollments:
        _close_history(db, enrollment.student_id, class_room.id, class_room.name)
        db.delete(enrollment)

    class_room.is_active = False
    class_room.archived_at = datetime.utcnow()
    class_room.archived_by = current_user.id
    db.commit()
    return {
        "status": "ok",
        "archived": True,
        "deleted_id": class_id,
        "preserved": ["grades", "attendance", "assignments", "schedule", "submissions", "documents"],
        "students_moved_to_history": len(enrollments),
    }


@router.get("/student/{student_id}/history", response_model=List[schemas.StudentClassHistoryOut])
def student_class_history(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Полная история классов ученика с сохранёнными показателями оценок и посещаемости."""
    student = db.query(models.User).filter(
        models.User.id == student_id,
        models.User.role == models.Role.student,
    ).first()
    if not student:
        raise HTTPException(status_code=404, detail="Ученик не найден")

    role = _role(current_user)
    allowed = False
    if role == "admin":
        allowed = True
    elif role == "student":
        allowed = current_user.id == student_id
    elif role == "parent":
        allowed = db.query(models.ParentStudent).filter(
            models.ParentStudent.parent_id == current_user.id,
            models.ParentStudent.student_id == student_id,
        ).first() is not None
    elif role == "teacher":
        visible_ids = teacher_class_ids(db, current_user.id)
        allowed = db.query(models.StudentClassHistory).filter(
            models.StudentClassHistory.student_id == student_id,
            models.StudentClassHistory.class_id.in_(visible_ids),
        ).first() is not None

    if not allowed:
        raise HTTPException(status_code=403, detail="Нет доступа к истории ученика")

    return _student_history_payload(db, student_id)


@router.get("/student-candidates", response_model=List[schemas.ClassStudentCandidateOut])
def student_candidates(
    class_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    """Ученики для перевода в выбранный класс, включая тех, кто уже учится в другом классе."""
    target = db.query(models.ClassRoom).filter(models.ClassRoom.id == class_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Класс не найден")
    _ensure_active_class(target)

    role = _role(current_user)
    students = db.query(models.User).filter(
        models.User.role == models.Role.student,
        models.User.approval_status == "approved",
    ).order_by(models.User.full_name.asc()).all()
    payload = []
    for student in students:
        enrollment = db.query(models.Enrollment).filter(
            models.Enrollment.student_id == student.id
        ).first()
        current_class = None
        if enrollment:
            current_class = db.query(models.ClassRoom).filter(models.ClassRoom.id == enrollment.class_id).first()
            if current_class and current_class.id == class_id:
                continue
            if role != "admin":
                # Учитель может добавлять только ученика без текущего класса;
                # перевод между классами остаётся операцией администратора.
                continue
        payload.append({
            "id": student.id,
            "full_name": student.full_name,
            "email": student.email,
            "current_class_id": current_class.id if current_class else None,
            "current_class_name": current_class.name if current_class else None,
        })
    return payload


@router.get("/{class_id}/students", response_model=List[schemas.UserOut])
def class_students(
    class_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Список учеников активного класса."""
    role = _role(current_user)
    class_room = db.query(models.ClassRoom).filter(models.ClassRoom.id == class_id).first()
    if not class_room:
        raise HTTPException(status_code=404, detail="Класс не найден")
    if not class_room.is_active:
        raise HTTPException(status_code=404, detail="Класс находится в архиве")

    if role == "teacher" and class_id not in teacher_class_ids(db, current_user.id):
        raise HTTPException(status_code=403, detail="Нет доступа к этому классу")
    if role == "student":
        enrolled = db.query(models.Enrollment).filter(
            models.Enrollment.class_id == class_id, models.Enrollment.student_id == current_user.id
        ).first()
        if not enrolled:
            raise HTTPException(status_code=403, detail="Нет доступа к этому классу")
    if role == "parent":
        child_ids = [ps.student_id for ps in
                     db.query(models.ParentStudent).filter(models.ParentStudent.parent_id == current_user.id).all()]
        enrolled = db.query(models.Enrollment).filter(
            models.Enrollment.class_id == class_id, models.Enrollment.student_id.in_(child_ids)
        ).first()
        if not enrolled:
            raise HTTPException(status_code=403, detail="Нет доступа к этому классу")

    student_ids = [e.student_id for e in db.query(models.Enrollment).filter(models.Enrollment.class_id == class_id).all()]
    return db.query(models.User).filter(models.User.id.in_(student_ids)).all()


@router.post("/{class_id}/enroll", response_model=schemas.ClassOut)
def enroll_student(
    class_id: int,
    enroll_in: schemas.EnrollIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("teacher", "admin")),
):
    class_room = db.query(models.ClassRoom).filter(models.ClassRoom.id == class_id).first()
    if not class_room:
        raise HTTPException(status_code=404, detail="Класс не найден")
    _ensure_active_class(class_room)

    student = db.query(models.User).filter(
        models.User.id == enroll_in.student_id, models.User.role == models.Role.student,
        models.User.approval_status == "approved",
    ).first()
    if not student:
        raise HTTPException(status_code=404, detail="Ученик не найден")

    already_elsewhere = db.query(models.Enrollment).filter(
        models.Enrollment.student_id == student.id
    ).first()
    role = _role(current_user)
    if already_elsewhere and already_elsewhere.class_id != class_id:
        if role != "admin":
            raise HTTPException(status_code=400, detail="Этот ученик уже состоит в другом классе. Перевести ученика может администратор.")
        old_class = db.query(models.ClassRoom).filter(models.ClassRoom.id == already_elsewhere.class_id).first()
        if old_class:
            _close_history(db, student.id, old_class.id, old_class.name)
        db.delete(already_elsewhere)
        db.flush()

    exists = db.query(models.Enrollment).filter(
        models.Enrollment.class_id == class_id, models.Enrollment.student_id == student.id
    ).first()
    if not exists:
        _open_history(db, student.id, class_room)
        db.add(models.Enrollment(class_id=class_id, student_id=student.id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=400, detail="Не удалось перевести ученика в этот класс")
    return class_room


@router.delete("/{class_id}/enroll/{student_id}")
def unenroll_student(
    class_id: int,
    student_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_roles("teacher", "admin")),
):
    enrollment = db.query(models.Enrollment).filter(
        models.Enrollment.class_id == class_id, models.Enrollment.student_id == student_id
    ).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Ученик не найден в этом классе")

    class_room = db.query(models.ClassRoom).filter(models.ClassRoom.id == class_id).first()
    if class_room:
        _close_history(db, student_id, class_id, class_room.name)
    db.delete(enrollment)
    db.commit()
    return {"status": "ok"}


@router.post("/link-parent")
def link_parent(
    link_in: schemas.ParentLinkIn,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_roles("admin")),
):
    exists = db.query(models.ParentStudent).filter(
        models.ParentStudent.parent_id == link_in.parent_id,
        models.ParentStudent.student_id == link_in.student_id,
    ).first()
    if not exists:
        db.add(models.ParentStudent(parent_id=link_in.parent_id, student_id=link_in.student_id))
        db.commit()
    return {"status": "ok"}
