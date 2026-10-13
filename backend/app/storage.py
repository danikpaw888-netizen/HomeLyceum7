"""Persistent file storage backed by the configured SQL database."""
import mimetypes
import os

from fastapi import HTTPException

from .database import SessionLocal
from .models import StoredFile


def store_upload(file_path: str, original_filename: str, content: bytes, content_type: str | None = None) -> None:
    """Persist uploaded bytes in the same durable database used for school records."""
    session = SessionLocal()
    try:
        guessed_type = content_type or mimetypes.guess_type(original_filename)[0] or "application/octet-stream"
        row = session.query(StoredFile).filter(StoredFile.file_path == file_path).first()
        if row is None:
            row = StoredFile(file_path=file_path, original_filename=original_filename,
                             content_type=guessed_type, content=content)
            session.add(row)
        else:
            row.original_filename = original_filename
            row.content_type = guessed_type
            row.content = content
        session.commit()
    except Exception:
        session.rollback()
        raise HTTPException(status_code=500, detail="Не удалось сохранить файл в базе данных")
    finally:
        session.close()


def delete_stored_upload(file_path: str | None) -> None:
    if not file_path:
        return
    session = SessionLocal()
    try:
        row = session.query(StoredFile).filter(StoredFile.file_path == file_path).first()
        if row:
            session.delete(row)
            session.commit()
    finally:
        session.close()
