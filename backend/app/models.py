import enum
from datetime import datetime, date

from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Date, ForeignKey, Enum, UniqueConstraint, Boolean, LargeBinary
)
from sqlalchemy.orm import relationship

from .database import Base


class Role(str, enum.Enum):
    student = "student"
    teacher = "teacher"
    parent = "parent"
    admin = "admin"


class AttendanceStatus(str, enum.Enum):
    present = "present"
    absent = "absent"
    excused = "excused"
    late = "late"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(100), nullable=False)
    email = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    must_change_password = Column(Boolean, nullable=False, default=False, server_default="false")
    role = Column(Enum(Role), nullable=False)
    # Новые учётные записи ждут проверки администратора.
    # Строковый статус удобнее для SQLite/PostgreSQL и допускает pending/approved/rejected.
    approval_status = Column(String(20), nullable=False, default="approved", server_default="approved")
    approved_at = Column(DateTime, nullable=True)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    taught_classes = relationship("ClassRoom", back_populates="teacher", foreign_keys="ClassRoom.teacher_id")
    enrollments = relationship("Enrollment", back_populates="student", foreign_keys="Enrollment.student_id")


class ClassRoom(Base):
    __tablename__ = "classes"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(10), nullable=False)  # напр. "9А"
    teacher_id = Column(Integer, ForeignKey("users.id"))
    # Архивный класс больше не показывается в активном списке, но сама запись
    # и все связанные с ней учебные данные остаются в БД навсегда.
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")
    archived_at = Column(DateTime, nullable=True)
    archived_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    teacher = relationship("User", back_populates="taught_classes", foreign_keys=[teacher_id])
    enrollments = relationship("Enrollment", back_populates="class_room")
    assignments = relationship("Assignment", back_populates="class_room")


class Enrollment(Base):
    """Связь ученик <-> класс. Один ученик может быть закреплён только за ОДНИМ
    классом — ограничение на уровне БД (не только проверка в коде)."""
    __tablename__ = "enrollments"
    __table_args__ = (
        UniqueConstraint("class_id", "student_id", name="uq_class_student"),
        UniqueConstraint("student_id", name="uq_student_single_class"),
    )

    id = Column(Integer, primary_key=True, index=True)
    class_id = Column(Integer, ForeignKey("classes.id"))
    student_id = Column(Integer, ForeignKey("users.id"))

    class_room = relationship("ClassRoom", back_populates="enrollments")
    student = relationship("User", back_populates="enrollments", foreign_keys=[student_id])


class StudentClassHistory(Base):
    """История обучения ученика по классам.

    История независима от текущего Enrollment: перевод ученика или удаление
    класса закрывает текущую запись истории, но никогда не удаляет оценки,
    посещаемость, задания и другие учебные события.
    """
    __tablename__ = "student_class_history"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    class_id = Column(Integer, ForeignKey("classes.id"), nullable=False)
    class_name = Column(String(50), nullable=False)
    joined_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    left_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    student = relationship("User", foreign_keys=[student_id])
    class_room = relationship("ClassRoom", foreign_keys=[class_id])


class ParentStudent(Base):
    """Связь родитель <-> ребёнок."""
    __tablename__ = "parent_students"
    __table_args__ = (UniqueConstraint("parent_id", "student_id", name="uq_parent_student"),)

    id = Column(Integer, primary_key=True, index=True)
    parent_id = Column(Integer, ForeignKey("users.id"))
    student_id = Column(Integer, ForeignKey("users.id"))

    parent = relationship("User", foreign_keys=[parent_id])
    student = relationship("User", foreign_keys=[student_id])


class StoredFile(Base):
    """File bytes stored in the persistent SQL database, not Render's ephemeral disk."""
    __tablename__ = "stored_files"

    id = Column(Integer, primary_key=True, index=True)
    file_path = Column(String(500), nullable=False, unique=True, index=True)
    original_filename = Column(String(255), nullable=False)
    content_type = Column(String(150), nullable=False, default="application/octet-stream")
    content = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Assignment(Base):
    __tablename__ = "assignments"

    id = Column(Integer, primary_key=True, index=True)
    class_id = Column(Integer, ForeignKey("classes.id"))
    teacher_id = Column(Integer, ForeignKey("users.id"))
    subject = Column(String(100), default="")
    title = Column(String(150), nullable=False)
    description = Column(Text, default="")
    deadline = Column(DateTime, nullable=False)
    file_path = Column(String(500), nullable=True)
    original_filename = Column(String(255), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    deleted_at = Column(DateTime, nullable=True)
    allow_resubmission = Column(Boolean, nullable=False, default=True, server_default="true")
    max_attempts = Column(Integer, nullable=False, default=3, server_default="3")
    created_at = Column(DateTime, default=datetime.utcnow)

    class_room = relationship("ClassRoom", back_populates="assignments")
    submissions = relationship("Submission", back_populates="assignment")
    attachments = relationship("AssignmentAttachment", back_populates="assignment", cascade="all, delete-orphan")


class AssignmentAttachment(Base):
    __tablename__ = "assignment_attachments"

    id = Column(Integer, primary_key=True, index=True)
    assignment_id = Column(Integer, ForeignKey("assignments.id"), nullable=False, index=True)
    file_path = Column(String(500), nullable=False)
    original_filename = Column(String(255), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime, default=datetime.utcnow)

    assignment = relationship("Assignment", back_populates="attachments")


class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (UniqueConstraint("assignment_id", "student_id", name="uq_assignment_student"),)

    id = Column(Integer, primary_key=True, index=True)
    assignment_id = Column(Integer, ForeignKey("assignments.id"))
    student_id = Column(Integer, ForeignKey("users.id"))
    file_path = Column(String(500), nullable=True)
    original_filename = Column(String(255), nullable=True)
    comment = Column(Text, default="")
    grade = Column(Integer, nullable=True)
    teacher_feedback = Column(Text, default="")
    # Existing submissions are treated as already turned in.
    is_submitted = Column(Boolean, nullable=False, default=True, server_default="true")
    submitted_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    graded_at = Column(DateTime, nullable=True)
    attempt_count = Column(Integer, nullable=False, default=1, server_default="1")

    assignment = relationship("Assignment", back_populates="submissions")
    student = relationship("User")
    attachments = relationship("SubmissionAttachment", back_populates="submission", cascade="all, delete-orphan")
    attempts = relationship("SubmissionAttempt", back_populates="submission", cascade="all, delete-orphan")


class SubmissionAttachment(Base):
    __tablename__ = "submission_attachments"

    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(Integer, ForeignKey("submissions.id"), nullable=False, index=True)
    file_path = Column(String(500), nullable=False)
    original_filename = Column(String(255), nullable=False)
    is_current = Column(Boolean, nullable=False, default=True, server_default="true")
    attempt_number = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)

    submission = relationship("Submission", back_populates="attachments")


class SubmissionAttempt(Base):
    __tablename__ = "submission_attempts"

    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(Integer, ForeignKey("submissions.id"), nullable=False, index=True)
    attempt_number = Column(Integer, nullable=False)
    file_path = Column(String(500), nullable=True)
    original_filename = Column(String(255), nullable=True)
    comment = Column(Text, default="")
    grade = Column(Integer, nullable=True)
    teacher_feedback = Column(Text, default="")
    submitted_at = Column(DateTime, nullable=True)
    graded_at = Column(DateTime, nullable=True)
    attachments_json = Column(Text, default="[]")
    archived_at = Column(DateTime, default=datetime.utcnow)

    submission = relationship("Submission", back_populates="attempts")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (UniqueConstraint("dedupe_key", name="uq_notification_dedupe_key"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    notification_type = Column(String(40), nullable=False, default="info")
    title = Column(String(180), nullable=False)
    message = Column(Text, nullable=False)
    link = Column(String(250), nullable=True)
    dedupe_key = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    read_at = Column(DateTime, nullable=True)

    user = relationship("User")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    actor_name = Column(String(100), nullable=False, default="Система")
    action = Column(String(60), nullable=False)
    entity_type = Column(String(60), nullable=False)
    entity_id = Column(Integer, nullable=True)
    details = Column(Text, default="")
    before_json = Column(Text, nullable=True)
    after_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    actor = relationship("User")



class Quiz(Base):
    __tablename__ = "quizzes"

    id = Column(Integer, primary_key=True, index=True)
    class_id = Column(Integer, ForeignKey("classes.id"), nullable=False, index=True)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    subject = Column(String(100), default="")
    title = Column(String(180), nullable=False)
    description = Column(Text, default="")
    deadline = Column(DateTime, nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    attempts_allowed = Column(Integer, nullable=False, default=1, server_default="1")
    is_published = Column(Boolean, nullable=False, default=True, server_default="true")
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    class_room = relationship("ClassRoom")
    teacher = relationship("User")
    questions = relationship("QuizQuestion", back_populates="quiz", cascade="all, delete-orphan", order_by="QuizQuestion.order_index")
    attempts = relationship("QuizAttempt", back_populates="quiz")


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id = Column(Integer, primary_key=True, index=True)
    quiz_id = Column(Integer, ForeignKey("quizzes.id"), nullable=False, index=True)
    question_text = Column(Text, nullable=False)
    question_type = Column(String(20), nullable=False, default="single")
    points = Column(Integer, nullable=False, default=1)
    order_index = Column(Integer, nullable=False, default=0)

    quiz = relationship("Quiz", back_populates="questions")
    options = relationship("QuizOption", back_populates="question", cascade="all, delete-orphan", order_by="QuizOption.order_index")
    answers = relationship("QuizAnswer", back_populates="question")


class QuizOption(Base):
    __tablename__ = "quiz_options"

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("quiz_questions.id"), nullable=False, index=True)
    option_text = Column(Text, nullable=False)
    is_correct = Column(Boolean, nullable=False, default=False, server_default="false")
    order_index = Column(Integer, nullable=False, default=0)

    question = relationship("QuizQuestion", back_populates="options")


class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"

    id = Column(Integer, primary_key=True, index=True)
    quiz_id = Column(Integer, ForeignKey("quizzes.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    attempt_number = Column(Integer, nullable=False, default=1)
    status = Column(String(30), nullable=False, default="in_progress")
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    submitted_at = Column(DateTime, nullable=True)
    score = Column(Integer, nullable=False, default=0)
    max_score = Column(Integer, nullable=False, default=0)

    quiz = relationship("Quiz", back_populates="attempts")
    student = relationship("User")
    answers = relationship("QuizAnswer", back_populates="attempt", cascade="all, delete-orphan")


class QuizAnswer(Base):
    __tablename__ = "quiz_answers"

    id = Column(Integer, primary_key=True, index=True)
    attempt_id = Column(Integer, ForeignKey("quiz_attempts.id"), nullable=False, index=True)
    question_id = Column(Integer, ForeignKey("quiz_questions.id"), nullable=False, index=True)
    selected_option_ids = Column(Text, default="[]")
    text_answer = Column(Text, default="")
    is_correct = Column(Boolean, nullable=True)
    points_awarded = Column(Integer, nullable=False, default=0)
    feedback = Column(Text, default="")

    attempt = relationship("QuizAttempt", back_populates="answers")
    question = relationship("QuizQuestion", back_populates="answers")


class GradeEntry(Base):
    """Оценка, поставленная учителем напрямую в журнале (не за конкретное ДЗ)."""
    __tablename__ = "grade_entries"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"))
    class_id = Column(Integer, ForeignKey("classes.id"))
    teacher_id = Column(Integer, ForeignKey("users.id"))
    subject = Column(String(100), nullable=False)
    grade = Column(Integer, nullable=False)
    date = Column(Date, nullable=False, default=date.today)
    comment = Column(Text, default="")
    # Nullable for ordinary journal grades; populated for homework grades.
    submission_id = Column(Integer, ForeignKey("submissions.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    student = relationship("User", foreign_keys=[student_id])


class Attendance(Base):
    """Посещаемость ученика по предмету за дату."""
    __tablename__ = "attendance"
    __table_args__ = (
        UniqueConstraint("student_id", "class_id", "subject", "date", name="uq_attendance_entry"),
    )

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"))
    class_id = Column(Integer, ForeignKey("classes.id"))
    teacher_id = Column(Integer, ForeignKey("users.id"))
    subject = Column(String(100), default="")
    date = Column(Date, nullable=False, default=date.today)
    status = Column(Enum(AttendanceStatus), nullable=False)
    note = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    student = relationship("User", foreign_keys=[student_id])


class ScheduleLesson(Base):
    """Урок в расписании класса. Создавать/редактировать может только админ."""
    __tablename__ = "schedule_lessons"

    id = Column(Integer, primary_key=True, index=True)
    class_id = Column(Integer, ForeignKey("classes.id"))
    subject = Column(String(100), nullable=False)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    day_of_week = Column(Integer, nullable=False)  # 1 = Пн ... 7 = Вс
    start_time = Column(String(5), nullable=False)  # "08:30"
    end_time = Column(String(5), nullable=False)
    room = Column(String(50), default="")
    note = Column(Text, default="")
    # Какую неделю использует урок: all / even / odd.
    week_type = Column(String(10), nullable=False, default="all", server_default="all")
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    class_room = relationship("ClassRoom")
    teacher = relationship("User", foreign_keys=[teacher_id])


class HomeschoolRecord(Base):
    """Перевод ученика на домашнее обучение и его история."""
    __tablename__ = "homeschool_records"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"))
    reason = Column(Text, nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)
    topics_covered = Column(Text, default="")
    notes = Column(Text, default="")
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    student = relationship("User", foreign_keys=[student_id])
    documents = relationship("HomeschoolDocument", back_populates="record", cascade="all, delete-orphan")


class HomeschoolDocument(Base):
    """Отдельный документ в деле домашнего обучения: приказ, справка, заявление и т.д."""
    __tablename__ = "homeschool_documents"

    id = Column(Integer, primary_key=True, index=True)
    record_id = Column(Integer, ForeignKey("homeschool_records.id"), nullable=False)
    document_type = Column(String(50), nullable=False)
    title = Column(String(150), nullable=False)
    file_path = Column(String(500), nullable=False)
    original_filename = Column(String(255), nullable=False)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    record = relationship("HomeschoolRecord", back_populates="documents")
