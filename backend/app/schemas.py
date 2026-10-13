from datetime import datetime, date
from typing import Optional, List, Literal

from pydantic import BaseModel, EmailStr, ConfigDict

from .models import Role, AttendanceStatus


# ---------- Users / Auth ----------

class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    role: Role


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str
    # Сохраняем строковый email в ответе API: bootstrap-администратор использует
    # локальный адрес admin@homelyceum.local, который EmailStr намеренно не принимает.
    email: str
    role: Role
    approval_status: str
    must_change_password: bool = False


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
    message: Optional[str] = None


# ---------- Classes ----------

class ClassCreate(BaseModel):
    name: str


class ClassOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    teacher_id: Optional[int] = None
    is_active: bool = True


class EnrollIn(BaseModel):
    student_id: int

class ClassStudentCandidateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str
    email: str
    current_class_id: Optional[int] = None
    current_class_name: Optional[str] = None


class StudentClassHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    student_id: int
    class_id: int
    class_name: str
    joined_at: datetime
    left_at: Optional[datetime] = None
    grades_count: int = 0
    attendance_count: int = 0


class ParentLinkIn(BaseModel):
    parent_id: int
    student_id: int


# ---------- Assignments ----------

class AssignmentCreate(BaseModel):
    class_id: int
    subject: str = ""
    title: str
    description: str = ""
    deadline: datetime


class AssignmentAttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    assignment_id: int
    file_path: str
    original_filename: str
    is_active: bool = True
    created_at: datetime


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    class_id: int
    teacher_id: int
    subject: str
    title: str
    description: str
    deadline: datetime
    file_path: Optional[str] = None
    original_filename: Optional[str] = None
    is_active: bool = True
    deleted_at: Optional[datetime] = None
    allow_resubmission: bool = True
    max_attempts: int = 3
    attachments: List[AssignmentAttachmentOut] = []
    created_at: datetime


# ---------- Submissions ----------

class SubmissionAttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    submission_id: int
    file_path: str
    original_filename: str
    is_current: bool = True
    attempt_number: int = 1
    created_at: datetime


class SubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    assignment_id: int
    student_id: int
    file_path: Optional[str] = None
    original_filename: Optional[str] = None
    comment: str
    grade: Optional[int] = None
    teacher_feedback: str
    submitted_at: datetime
    graded_at: Optional[datetime] = None
    attempt_count: int = 1
    attachments: List[SubmissionAttachmentOut] = []


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    notification_type: str
    title: str
    message: str
    link: Optional[str] = None
    created_at: datetime
    read_at: Optional[datetime] = None


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    actor_id: Optional[int] = None
    actor_name: str
    action: str
    entity_type: str
    entity_id: Optional[int] = None
    details: str = ""
    before_json: Optional[str] = None
    after_json: Optional[str] = None
    created_at: datetime


class GradeIn(BaseModel):
    grade: int
    teacher_feedback: str = ""


# ---------- Журнал: оценки и посещаемость ----------

class GradeEntryCreate(BaseModel):
    student_id: int
    class_id: int
    subject: str
    grade: int
    date: date
    comment: str = ""


class GradeEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    student_id: int
    class_id: int
    teacher_id: int
    subject: str
    grade: int
    date: date
    comment: str


class GradeEntryUpdate(BaseModel):
    grade: int
    comment: Optional[str] = None


class AttendanceCreate(BaseModel):
    student_id: int
    class_id: int
    subject: str = ""
    date: date
    status: AttendanceStatus
    note: str = ""


class AttendanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    student_id: int
    class_id: int
    teacher_id: int
    subject: str
    date: date
    status: AttendanceStatus
    note: str


class RosterStudent(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    grades: List[GradeEntryOut]
    attendance: List[AttendanceOut]
    on_homeschool: bool


class RosterOut(BaseModel):
    class_id: int
    students: List[RosterStudent]


class StudentGradeItem(BaseModel):
    subject: str
    grade: int
    date: datetime
    source: str  # "assignment" | "journal"
    label: str
    comment: str = ""


# ---------- Расписание ----------

class ScheduleLessonCreate(BaseModel):
    class_id: int
    subject: str
    teacher_id: Optional[int] = None
    day_of_week: int  # 1 (Пн) .. 7 (Вс)
    start_time: str
    end_time: str
    room: str = ""
    note: str = ""
    week_type: Literal["all", "even", "odd"] = "all"


class ScheduleLessonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    class_id: int
    subject: str
    teacher_id: Optional[int] = None
    day_of_week: int
    start_time: str
    end_time: str
    room: str
    note: str
    week_type: Literal["all", "even", "odd"]
    created_by: int


# ---------- Домашнее обучение ----------

class HomeschoolDocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    record_id: int
    document_type: str
    title: str
    file_path: str
    original_filename: str
    uploaded_by: int
    created_at: datetime


class HomeschoolOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    student_id: int
    reason: str
    start_date: date
    end_date: Optional[date] = None
    topics_covered: str
    notes: str
    created_by: int
    created_at: datetime
    documents: List[HomeschoolDocumentOut] = []


class HomeschoolCloseIn(BaseModel):
    end_date: date
    topics_covered: str = ""
    notes: str = ""


class UserApprovalIn(BaseModel):
    approved: bool


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str


# ---------- Онлайн-тесты и контрольные ----------

class QuizOptionCreate(BaseModel):
    option_text: str


class QuizQuestionCreate(BaseModel):
    question_text: str
    question_type: Literal["single", "multiple", "text"] = "single"
    points: int = 1
    options: List[QuizOptionCreate] = []
    correct_option_indexes: List[int] = []


class QuizCreateIn(BaseModel):
    class_id: int
    subject: str = ""
    title: str
    description: str = ""
    deadline: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    attempts_allowed: int = 1
    is_published: bool = True
    questions: List[QuizQuestionCreate]


class QuizOptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    option_text: str
    order_index: int


class QuizQuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    question_text: str
    question_type: Literal["single", "multiple", "text"]
    points: int
    order_index: int
    options: List[QuizOptionOut] = []


class QuizOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    class_id: int
    teacher_id: int
    subject: str
    title: str
    description: str
    deadline: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    attempts_allowed: int
    is_published: bool
    is_active: bool
    created_at: datetime
    questions: List[QuizQuestionOut] = []


class StudentQuizOut(QuizOut):
    attempts_used: int = 0
    latest_attempt_id: Optional[int] = None
    latest_attempt_status: Optional[str] = None
    latest_score: Optional[int] = None
    latest_max_score: Optional[int] = None
    can_attempt: bool = True


class QuizAttemptStartOut(BaseModel):
    id: int
    quiz_id: int
    attempt_number: int
    status: str
    started_at: datetime
    max_score: int


class QuizAnswerIn(BaseModel):
    question_id: int
    selected_option_ids: List[int] = []
    text_answer: str = ""


class QuizSubmissionIn(BaseModel):
    answers: List[QuizAnswerIn] = []


class QuizAnswerOut(BaseModel):
    id: int
    question_id: int
    question_text: str
    question_type: str
    points_available: int
    selected_option_ids: List[int] = []
    selected_options: List[str] = []
    text_answer: str = ""
    is_correct: Optional[bool] = None
    points_awarded: int = 0
    feedback: str = ""


class QuizAttemptOut(BaseModel):
    id: int
    quiz_id: int
    student_id: int
    student_name: Optional[str] = None
    attempt_number: int
    status: str
    started_at: datetime
    submitted_at: Optional[datetime] = None
    score: int = 0
    max_score: int = 0
    answers: List[QuizAnswerOut] = []


class QuizAnswerGradeIn(BaseModel):
    answer_id: int
    points_awarded: int
    feedback: str = ""


class QuizAttemptGradeIn(BaseModel):
    answers: List[QuizAnswerGradeIn] = []
