import mimetypes
import os
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import models
from ..auth import get_current_user
from ..config import settings
from ..database import get_db

router = APIRouter(prefix="/files", tags=["private files"])


def _role(user: models.User) -> str:
    return user.role.value if hasattr(user.role, "value") else str(user.role)


def _same_file(path: Optional[str], filename: str) -> bool:
    return bool(path) and os.path.basename(path.replace("\\", "/")) == filename


def _can_access_assignment(db: Session, user: models.User, assignment: models.Assignment) -> bool:
    role = _role(user)
    if role == "admin":
        return True
    if role == "teacher":
        if assignment.teacher_id == user.id:
            return True
        classroom = db.query(models.ClassRoom).filter(models.ClassRoom.id == assignment.class_id).first()
        if classroom and classroom.teacher_id == user.id:
            return True
        return bool(db.query(models.ScheduleLesson.id).filter(
            models.ScheduleLesson.class_id == assignment.class_id,
            models.ScheduleLesson.teacher_id == user.id,
        ).first())
    if role == "student":
        if db.query(models.Enrollment.id).filter(
            models.Enrollment.class_id == assignment.class_id,
            models.Enrollment.student_id == user.id,
        ).first():
            return True
        return bool(db.query(models.Submission.id).filter(
            models.Submission.assignment_id == assignment.id,
            models.Submission.student_id == user.id,
        ).first())
    if role == "parent":
        child_ids = [row.student_id for row in db.query(models.ParentStudent).filter(
            models.ParentStudent.parent_id == user.id
        ).all()]
        if not child_ids:
            return False
        enrolled = db.query(models.Enrollment.id).filter(
            models.Enrollment.class_id == assignment.class_id,
            models.Enrollment.student_id.in_(child_ids),
        ).first()
        submitted = db.query(models.Submission.id).filter(
            models.Submission.assignment_id == assignment.id,
            models.Submission.student_id.in_(child_ids),
        ).first()
        return bool(enrolled or submitted)
    return False


def _can_access_document(db: Session, user: models.User, record: models.HomeschoolRecord) -> bool:
    role = _role(user)
    if role == "admin" or (role == "student" and record.student_id == user.id):
        return True
    if role == "parent":
        return bool(db.query(models.ParentStudent.id).filter(
            models.ParentStudent.parent_id == user.id,
            models.ParentStudent.student_id == record.student_id,
        ).first())
    return False


@router.get("/{filename}")
def download_private_file(
    filename: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # Only opaque server-generated filenames are accepted. Never join a user path
    # to the filesystem or expose the old /uploads mount as a public directory.
    if filename != os.path.basename(filename) or filename in ("", ".", "..") or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=404, detail="Файл не найден")

    matches: list[Tuple[str, str]] = []
    for attachment in db.query(models.AssignmentAttachment).filter(
        models.AssignmentAttachment.file_path.endswith("/" + filename)
    ).all():
        assignment = db.query(models.Assignment).filter(models.Assignment.id == attachment.assignment_id).first()
        if assignment and _can_access_assignment(db, current_user, assignment):
            matches.append((attachment.file_path, attachment.original_filename))

    for assignment in db.query(models.Assignment).filter(
        models.Assignment.file_path.endswith("/" + filename)
    ).all():
        if _can_access_assignment(db, current_user, assignment):
            matches.append((assignment.file_path, assignment.original_filename or filename))

    for attachment in db.query(models.SubmissionAttachment).filter(
        models.SubmissionAttachment.file_path.endswith("/" + filename)
    ).all():
        submission = db.query(models.Submission).filter(models.Submission.id == attachment.submission_id).first()
        if submission:
            assignment = db.query(models.Assignment).filter(models.Assignment.id == submission.assignment_id).first()
            role = _role(current_user)
            permitted = role == "admin" or submission.student_id == current_user.id
            if assignment and _can_access_assignment(db, current_user, assignment):
                permitted = True
            if role == "parent":
                permitted = permitted or bool(db.query(models.ParentStudent.id).filter(
                    models.ParentStudent.parent_id == current_user.id,
                    models.ParentStudent.student_id == submission.student_id,
                ).first())
            if permitted:
                matches.append((attachment.file_path, attachment.original_filename))

    for submission in db.query(models.Submission).filter(
        models.Submission.file_path.endswith("/" + filename)
    ).all():
        assignment = db.query(models.Assignment).filter(models.Assignment.id == submission.assignment_id).first()
        role = _role(current_user)
        permitted = role == "admin" or submission.student_id == current_user.id
        if assignment and _can_access_assignment(db, current_user, assignment):
            permitted = True
        if role == "parent":
            permitted = permitted or bool(db.query(models.ParentStudent.id).filter(
                models.ParentStudent.parent_id == current_user.id,
                models.ParentStudent.student_id == submission.student_id,
            ).first())
        if permitted:
            matches.append((submission.file_path, submission.original_filename or filename))

    for document in db.query(models.HomeschoolDocument).filter(
        models.HomeschoolDocument.file_path.endswith("/" + filename)
    ).all():
        record = db.query(models.HomeschoolRecord).filter(
            models.HomeschoolRecord.id == document.record_id
        ).first()
        if record and _can_access_document(db, current_user, record):
            matches.append((document.file_path, document.original_filename or document.title or filename))

    if not matches:
        # Returning the same response for missing and forbidden files avoids
        # revealing whether a private document exists.
        raise HTTPException(status_code=404, detail="Файл не найден")

    stored_path, original_name = matches[0]
    upload_root = os.path.realpath(settings.UPLOAD_DIR)
    disk_path = os.path.realpath(os.path.join(upload_root, filename))
    if os.path.commonpath([upload_root, disk_path]) != upload_root or not os.path.isfile(disk_path):
        raise HTTPException(status_code=404, detail="Файл не найден")

    media_type = mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    return FileResponse(disk_path, filename=os.path.basename(original_name), media_type=media_type)
