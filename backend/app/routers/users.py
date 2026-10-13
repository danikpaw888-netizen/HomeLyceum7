from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime

from .. import models, schemas
from ..auth import get_current_user, require_roles
from ..database import get_db
from ..events import log_action

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=schemas.UserOut)
def get_me(current_user: models.User = Depends(get_current_user)):
    return current_user


@router.get("/my-children", response_model=List[schemas.UserOut])
def my_children(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("parent")),
):
    child_ids = [ps.student_id for ps in
                 db.query(models.ParentStudent).filter(models.ParentStudent.parent_id == current_user.id).all()]
    return db.query(models.User).filter(models.User.id.in_(child_ids)).all()


@router.get("/students-without-class", response_model=List[schemas.UserOut])
def students_without_class(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_roles("teacher", "admin")),
):
    enrolled_ids = [e.student_id for e in db.query(models.Enrollment).all()]
    q = db.query(models.User).filter(models.User.role == models.Role.student, models.User.approval_status == "approved")
    if enrolled_ids:
        q = q.filter(~models.User.id.in_(enrolled_ids))
    return q.all()


@router.get("/accounts", response_model=List[schemas.UserOut])
def admin_accounts(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_roles("admin")),
):
    return db.query(models.User).filter(
        models.User.approval_status != "deleted"
    ).order_by(models.User.created_at.desc()).all()


@router.get("/pending", response_model=List[schemas.UserOut])
def pending_users(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_roles("admin")),
):
    return db.query(models.User).filter(
        models.User.approval_status == "pending"
    ).order_by(models.User.created_at.asc()).all()


@router.put("/{user_id}/approval", response_model=schemas.UserOut)
def update_approval(
    user_id: int,
    payload: schemas.UserApprovalIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if user.role == models.Role.admin:
        raise HTTPException(status_code=400, detail="Нельзя менять статус администратора")
    if user.approval_status == "deleted":
        raise HTTPException(status_code=400, detail="Отключённый аккаунт нельзя одобрить повторно")
    previous_status = user.approval_status
    user.approval_status = "approved" if payload.approved else "rejected"
    user.approved_at = datetime.utcnow() if payload.approved else None
    user.approved_by = current_user.id if payload.approved else None
    log_action(db, current_user, "approve" if payload.approved else "reject", "user", user.id,
               f"{'Одобрена' if payload.approved else 'Отклонена'} заявка пользователя {user.email}",
               before={"approval_status": previous_status},
               after={"approval_status": user.approval_status, "email": user.email, "role": str(user.role.value if hasattr(user.role, 'value') else user.role)})
    db.commit()
    db.refresh(user)
    return user



@router.delete("/{user_id}")
def delete_account(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Аккаунт не найден")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя отключить собственный аккаунт администратора")
    if user.role == models.Role.admin:
        raise HTTPException(status_code=400, detail="Нельзя отключить аккаунт администратора")
    if user.approval_status == "deleted":
        return {"status": "ok", "deleted_id": user.id}

    previous_status = user.approval_status
    role_value = user.role.value if hasattr(user.role, "value") else str(user.role)
    now = datetime.utcnow()
    if role_value == "student":
        enrollments = db.query(models.Enrollment).filter(
            models.Enrollment.student_id == user.id
        ).all()
        for enrollment in enrollments:
            class_room = db.query(models.ClassRoom).filter(
                models.ClassRoom.id == enrollment.class_id
            ).first()
            history = db.query(models.StudentClassHistory).filter(
                models.StudentClassHistory.student_id == user.id,
                models.StudentClassHistory.class_id == enrollment.class_id,
                models.StudentClassHistory.left_at.is_(None),
            ).order_by(models.StudentClassHistory.joined_at.desc()).first()
            if history:
                history.left_at = now
                if class_room:
                    history.class_name = class_room.name

    user.approval_status = "deleted"
    user.approved_at = None
    user.approved_by = current_user.id
    log_action(
        db, current_user, "disable_account", "user", user.id,
        f"Отключён аккаунт «{user.full_name}» ({user.email}), роль: {role_value}. Учебная история сохранена.",
        before={"approval_status": previous_status, "role": role_value, "email": user.email},
        after={"approval_status": "deleted", "role": role_value, "email": user.email,
               "learning_history_preserved": True},
    )
    db.commit()
    return {
        "status": "ok",
        "deleted_id": user.id,
        "message": "Аккаунт отключён. Связанные учебные данные и история сохранены.",
    }


@router.post("/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
):
    """Сбрасывает пароль и возвращает временный пароль администратору только один раз."""
    import secrets
    import string
    from ..auth import hash_password

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Аккаунт не найден")
    if user.id == current_user.id or user.role == models.Role.admin:
        raise HTTPException(status_code=400, detail="Сброс пароля для аккаунта администратора запрещён этим действием")
    if user.approval_status == "deleted":
        raise HTTPException(status_code=400, detail="Нельзя сбросить пароль отключённого аккаунта")

    alphabet = string.ascii_letters + string.digits + "!@#$%_-"
    temporary_password = "".join(secrets.choice(alphabet) for _ in range(16))
    user.password_hash = hash_password(temporary_password)
    user.must_change_password = True
    log_action(db, current_user, "reset_password", "user", user.id,
               f"Администратор сбросил пароль пользователя {user.email}; требуется смена при следующем входе.",
               after={"email": user.email, "must_change_password": True})
    db.commit()
    return {"status": "ok", "temporary_password": temporary_password,
            "message": "Скопируйте временный пароль сейчас. Повторно показать его будет невозможно."}


@router.post("/change-password")
def change_password(
    payload: schemas.PasswordChangeIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    from ..auth import hash_password, verify_password
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Текущий пароль указан неверно")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Новый пароль должен содержать не менее 8 символов")
    current_user.password_hash = hash_password(payload.new_password)
    current_user.must_change_password = False
    db.commit()
    return {"status": "ok", "message": "Пароль успешно изменён"}

@router.get("/", response_model=List[schemas.UserOut])
def list_users(
    role: str | None = None,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_roles("admin", "teacher")),
):
    q = db.query(models.User).filter(models.User.approval_status == "approved")
    if role:
        q = q.filter(models.User.role == role)
    return q.all()
