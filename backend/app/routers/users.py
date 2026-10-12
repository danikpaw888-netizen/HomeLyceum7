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
