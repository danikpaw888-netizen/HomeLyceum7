from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import hash_password, verify_password, create_access_token
from ..database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=schemas.Token)
def register(user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    if user_in.role == models.Role.admin:
        raise HTTPException(status_code=403, detail="Регистрация администратора доступна только действующему администратору")

    existing = db.query(models.User).filter(models.User.email == user_in.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Пользователь с таким email уже существует")

    user = models.User(
        full_name=user_in.full_name,
        email=user_in.email,
        password_hash=hash_password(user_in.password),
        role=user_in.role,
        approval_status="pending",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Токен намеренно не выдаём: до одобрения администратором кабинет недоступен.
    return schemas.Token(
        access_token="",
        user=schemas.UserOut.model_validate(user),
        message="Заявка создана. Дождитесь одобрения администратора школы.",
    )


@router.post("/login", response_model=schemas.Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    if user.approval_status == "pending":
        raise HTTPException(status_code=403, detail="Учётная запись ожидает одобрения администратора")
    if user.approval_status == "rejected":
        raise HTTPException(status_code=403, detail="Заявка на регистрацию отклонена. Обратитесь в администрацию школы")
    if user.approval_status == "deleted":
        raise HTTPException(status_code=403, detail="Учётная запись отключена администратором")

    token = create_access_token({"sub": str(user.id), "role": user.role.value})
    return schemas.Token(access_token=token, user=schemas.UserOut.model_validate(user), message="must_change_password" if user.must_change_password else None)
