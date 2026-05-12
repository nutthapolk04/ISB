"""
Admin Audit Log API — paginated read of audit_logs table for admins.
"""
from datetime import date, datetime, time, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_role
from app.core.database import get_db
from app.models.audit_log import AuditLog
from app.models.user import User

router = APIRouter()


class AuditLogEntry(BaseModel):
    id: int
    created_at: datetime
    entity_type: str
    entity_id: Optional[int]
    action: str
    user_id: int
    user_username: Optional[str]
    user_full_name: Optional[str]
    changes: Optional[Any]
    ip_address: Optional[str]


class AuditLogListResponse(BaseModel):
    items: List[AuditLogEntry]
    total: int


@router.get("/audit-logs", response_model=AuditLogListResponse)
def list_audit_logs(
    entity_type: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    user_id: Optional[int] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    """List audit logs with filters. Admin only."""
    q = db.query(AuditLog).options(joinedload(AuditLog.user))

    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    if action:
        q = q.filter(AuditLog.action == action)
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if date_from:
        start = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        q = q.filter(AuditLog.created_at >= start)
    if date_to:
        end = datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        q = q.filter(AuditLog.created_at <= end)

    total = q.count()
    rows = (
        q.order_by(AuditLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    items = [
        AuditLogEntry(
            id=r.id,
            created_at=r.created_at,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            action=r.action.value if hasattr(r.action, "value") else str(r.action),
            user_id=r.user_id,
            user_username=r.user.username if r.user else None,
            user_full_name=r.user.full_name if r.user else None,
            changes=r.changes_json,
            ip_address=r.ip_address,
        )
        for r in rows
    ]

    return AuditLogListResponse(items=items, total=total)
