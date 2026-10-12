from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text

from .database import Base, engine, SessionLocal
from .config import settings
from . import models
from .auth import hash_password
from .routers import auth, users, classes, assignments, submissions, schedule, gradebook, homeschool
from .routers import notifications, calendar, reports, audit

# Создаём таблицы и мягко обновляем прототипную БД без обязательной ручной миграции.
Base.metadata.create_all(bind=engine)


def migrate_schema():
    inspector = inspect(engine)
    cols = {c["name"] for c in inspector.get_columns("users")}
    if "approval_status" not in cols:
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'"
            ))
    if "approved_at" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN approved_at TIMESTAMP"))
    if "approved_by" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN approved_by INTEGER"))

    class_cols = {c["name"] for c in inspector.get_columns("classes")}
    if "is_active" not in class_cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE classes ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1"))
    if "archived_at" not in class_cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE classes ADD COLUMN archived_at TIMESTAMP"))
    if "archived_by" not in class_cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE classes ADD COLUMN archived_by INTEGER"))

    # Мягкая миграция полей заданий и повторных попыток; старые записи не удаляются.
    assignment_cols = {c["name"] for c in inspect(engine).get_columns("assignments")}
    for name, sql_type in {
        "is_active": "BOOLEAN NOT NULL DEFAULT TRUE",
        "deleted_at": "TIMESTAMP",
        "allow_resubmission": "BOOLEAN NOT NULL DEFAULT TRUE",
        "max_attempts": "INTEGER NOT NULL DEFAULT 3",
    }.items():
        if name not in assignment_cols:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE assignments ADD COLUMN {name} {sql_type}"))

    submission_cols = {c["name"] for c in inspect(engine).get_columns("submissions")}
    if "attempt_count" not in submission_cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE submissions ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1"))

    db = SessionLocal()
    try:
        # Однофайловые вложения предыдущих версий показываются как записи новой модели.
        for item in db.query(models.Assignment).filter(models.Assignment.file_path.isnot(None)).all():
            existing_attachment = db.query(models.AssignmentAttachment).filter(
                models.AssignmentAttachment.assignment_id == item.id,
                models.AssignmentAttachment.file_path == item.file_path,
            ).first()
            if not existing_attachment:
                db.add(models.AssignmentAttachment(
                    assignment_id=item.id, file_path=item.file_path,
                    original_filename=item.original_filename or "Материал от учителя",
                    is_active=True,
                ))
        for item in db.query(models.Submission).filter(models.Submission.file_path.isnot(None)).all():
            existing_attachment = db.query(models.SubmissionAttachment).filter(
                models.SubmissionAttachment.submission_id == item.id,
                models.SubmissionAttachment.file_path == item.file_path,
            ).first()
            if not existing_attachment:
                db.add(models.SubmissionAttachment(
                    submission_id=item.id, file_path=item.file_path,
                    original_filename=item.original_filename or "Файл ученика",
                    is_current=True, attempt_number=item.attempt_count or 1,
                ))
        db.commit()
    finally:
        db.close()

    # История классов создаётся для уже существующих активных зачислений,
    # чтобы обновление не теряло прошлые сведения о переводах.
    db = SessionLocal()
    try:
        existing = db.query(models.Enrollment).all()
        for enrollment in existing:
            exists = db.query(models.StudentClassHistory).filter(
                models.StudentClassHistory.student_id == enrollment.student_id,
                models.StudentClassHistory.class_id == enrollment.class_id,
                models.StudentClassHistory.left_at.is_(None),
            ).first()
            if exists:
                continue
            class_room = db.query(models.ClassRoom).filter(models.ClassRoom.id == enrollment.class_id).first()
            if class_room:
                db.add(models.StudentClassHistory(
                    student_id=enrollment.student_id,
                    class_id=enrollment.class_id,
                    class_name=class_room.name,
                    joined_at=datetime.utcnow(),
                ))
        db.commit()
    finally:
        db.close()

    # Расширяем расписание: один и тот же урок можно задать отдельно
    # для чётной и нечётной недели. Старые уроки работают каждую неделю.
    schedule_cols = {c["name"] for c in inspector.get_columns("schedule_lessons")}
    if "week_type" not in schedule_cols:
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE schedule_lessons ADD COLUMN week_type VARCHAR(10) NOT NULL DEFAULT 'all'"
            ))

    # Возвращаем bootstrap-администратора к согласованным тестовым данным.
    # Ранние сборки использовали admin@homelyceum.kz, поэтому мягко переносим его
    # на запрошенный адрес .local, если адрес .local ещё не занят.
    if settings.BOOTSTRAP_ADMIN_EMAIL and settings.BOOTSTRAP_ADMIN_PASSWORD:
        db = SessionLocal()
        try:
            admin = db.query(models.User).filter(
                models.User.email == settings.BOOTSTRAP_ADMIN_EMAIL
            ).first()

            legacy_admin = None
            if not admin and settings.BOOTSTRAP_ADMIN_EMAIL == "admin@homelyceum.local":
                legacy_admin = db.query(models.User).filter(
                    models.User.email == "admin@homelyceum.kz",
                    models.User.role == models.Role.admin,
                ).first()

            if admin:
                # Bootstrap-учётка всегда остаётся активной и гарантированно
                # принимает пароль из настроек в локальной demo-сборке.
                admin.role = models.Role.admin
                admin.approval_status = "approved"
                admin.password_hash = hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD)
                if not admin.full_name:
                    admin.full_name = settings.BOOTSTRAP_ADMIN_NAME or "Главный администратор"
            elif legacy_admin:
                legacy_admin.email = settings.BOOTSTRAP_ADMIN_EMAIL
                legacy_admin.role = models.Role.admin
                legacy_admin.approval_status = "approved"
                legacy_admin.password_hash = hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD)
                admin = legacy_admin
            else:
                admin = models.User(
                    full_name=settings.BOOTSTRAP_ADMIN_NAME or "Главный администратор",
                    email=settings.BOOTSTRAP_ADMIN_EMAIL,
                    password_hash=hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD),
                    role=models.Role.admin,
                    approval_status="approved",
                )
                db.add(admin)

            db.commit()
        finally:
            db.close()


migrate_schema()

app = FastAPI(title="HomeLyceum7 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(f"/{settings.UPLOAD_DIR}", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(classes.router)
app.include_router(assignments.router)
app.include_router(submissions.router)
app.include_router(schedule.router)
app.include_router(gradebook.router)
app.include_router(homeschool.router)
app.include_router(notifications.router)
app.include_router(calendar.router)
app.include_router(reports.router)
app.include_router(audit.router)


@app.get("/")
def root():
    return {"message": "API школьной платформы работает"}
