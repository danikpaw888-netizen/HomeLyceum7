from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import require_roles
from ..database import get_db

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/", response_model=List[schemas.AuditLogOut])
def list_audit_logs(
    limit: int = Query(100, ge=1, le=500),
    entity_type: Optional[str] = None,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_roles("admin")),
):
    query = db.query(models.AuditLog)
    if entity_type:
        query = query.filter(models.AuditLog.entity_type == entity_type)
    return query.order_by(models.AuditLog.created_at.desc()).limit(limit).all()
