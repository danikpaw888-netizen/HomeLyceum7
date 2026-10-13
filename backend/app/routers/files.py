import mimetypes
import os
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from .. import models
from ..auth import get_current_user
from ..config import settings
from ..database import get_db
from ..access import norm_subject, teacher_subjects_in_class
from ..models import StoredFile

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
        # Having created an assignment or teaching another subject in the same
        # class does not grant access to its files; match the assigned subject.
        return norm_subject(assignment.subject) in teacher_subjects_in_class(
            db, user.id, assignment.class_id
        )
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


def _can_access_submission(
    db: Session,
    user: models.User,
    submission: models.Submission,
    assignment: Optional[models.Assignment],
) -> bool:
    role = _role(user)
    if role == "admin" or submission.student_id == user.id:
        return True
    if role == "parent":
        return bool(db.query(models.ParentStudent.id).filter(
            models.ParentStudent.parent_id == user.id,
            models.ParentStudent.student_id == submission.student_id,
        ).first())
    if role == "teacher" and assignment:
        return _can_access_assignment(db, user, assignment)
    return False


@router.get("/{filename:path}")
def download_private_file(
    filename: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # Support legacy nested upload paths while rejecting absolute paths and traversal.
    # The final filesystem path is resolved and checked against UPLOAD_DIR below.
    relative_path = filename.replace("\\", "/")
    path_parts = relative_path.split("/")
    if (
        not relative_path
        or relative_path.startswith("/")
        or any(part in ("", ".", "..") for part in path_parts)
        or ":" in path_parts[0]
        or "\x00" in relative_path
    ):
        raise HTTPException(status_code=404, detail="Файл не найден")

    matches: list[Tuple[str, str]] = []
    for attachment in db.query(models.AssignmentAttachment).filter(
        models.AssignmentAttachment.file_path.endswith("/" + relative_path)
    ).all():
        assignment = db.query(models.Assignment).filter(models.Assignment.id == attachment.assignment_id).first()
        if assignment and _can_access_assignment(db, current_user, assignment):
            matches.append((attachment.file_path, attachment.original_filename))

    for assignment in db.query(models.Assignment).filter(
        models.Assignment.file_path.endswith("/" + relative_path)
    ).all():
        if _can_access_assignment(db, current_user, assignment):
            matches.append((assignment.file_path, assignment.original_filename or filename))

    for attachment in db.query(models.SubmissionAttachment).filter(
        models.SubmissionAttachment.file_path.endswith("/" + relative_path)
    ).all():
        submission = db.query(models.Submission).filter(models.Submission.id == attachment.submission_id).first()
        if submission:
            assignment = db.query(models.Assignment).filter(models.Assignment.id == submission.assignment_id).first()
            if _can_access_submission(db, current_user, submission, assignment):
                matches.append((attachment.file_path, attachment.original_filename))

    for submission in db.query(models.Submission).filter(
        models.Submission.file_path.endswith("/" + relative_path)
    ).all():
        assignment = db.query(models.Assignment).filter(models.Assignment.id == submission.assignment_id).first()
        if _can_access_submission(db, current_user, submission, assignment):
            matches.append((submission.file_path, submission.original_filename or filename))

    for document in db.query(models.HomeschoolDocument).filter(
        models.HomeschoolDocument.file_path.endswith("/" + relative_path)
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

    # New uploads live in the SQL database, so they survive Render redeploys,
    # restarts, and ephemeral-filesystem cleanup. Keep disk fallback for legacy files.
    stored_file = db.query(StoredFile).filter(
        StoredFile.file_path == stored_path
    ).first()
    if stored_file is None:
        stored_file = db.query(StoredFile).filter(
            StoredFile.file_path.endswith("/" + relative_path.split("/")[-1])
        ).first()
    media_type = (
        stored_file.content_type if stored_file
        else mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    )
    if stored_file is not None:
        from urllib.parse import quote
        download_name = os.path.basename(original_name or stored_file.original_filename)
        return Response(
            content=stored_file.content,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(download_name)}"},
        )

    upload_root = os.path.realpath(settings.UPLOAD_DIR)
    disk_path = os.path.realpath(os.path.join(upload_root, relative_path))
    if os.path.commonpath([upload_root, disk_path]) != upload_root or not os.path.isfile(disk_path):
        raise HTTPException(status_code=404, detail="Файл не найден")
    return FileResponse(disk_path, filename=os.path.basename(original_name), media_type=media_type)
