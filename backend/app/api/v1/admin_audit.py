"""
Admin Audit Log API — paginated read of audit_logs table for admins.
Uses raw SQL to avoid ORM enum-mapping issues (action column is VARCHAR in DB).
"""
from datetime import date, datetime, time, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.database import get_db
from app.models.user import User

router = APIRouter()


class AuditLogEntry(BaseModel):
    id: int
    created_at: datetime
    entity_type: str
    entity_id: Optional[int]
    entity_name: Optional[str]
    shop_id: Optional[str]
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
    conditions = ["1=1"]
    params: dict = {}

    if entity_type:
        conditions.append("al.entity_type = :entity_type")
        params["entity_type"] = entity_type
    if action:
        conditions.append("al.action = :action")
        params["action"] = action
    if user_id:
        conditions.append("al.user_id = :user_id")
        params["user_id"] = user_id
    if date_from:
        start = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        conditions.append("al.created_at >= :date_from")
        params["date_from"] = start
    if date_to:
        end = datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        conditions.append("al.created_at <= :date_to")
        params["date_to"] = end

    where_sql = " AND ".join(conditions)

    total_row = db.execute(
        text(f"SELECT COUNT(*) FROM audit_logs al WHERE {where_sql}"),
        params,
    ).fetchone()
    total = total_row[0] if total_row else 0

    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size

    # Detect which optional columns exist to stay compatible with older DB schemas.
    col_check = db.execute(
        text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'audit_logs'
              AND column_name IN ('entity_name', 'shop_id')
        """)
    ).fetchall()
    existing_cols = {r[0] for r in col_check}
    has_entity_name = "entity_name" in existing_cols
    has_shop_id = "shop_id" in existing_cols

    entity_name_sel = "al.entity_name" if has_entity_name else "NULL"
    shop_id_sel = "al.shop_id" if has_shop_id else "NULL"

    rows = db.execute(
        text(f"""
            SELECT
                al.id,
                al.created_at,
                al.entity_type,
                al.entity_id,
                {entity_name_sel} AS entity_name,
                {shop_id_sel} AS shop_id,
                al.action,
                al.changes_json,
                al.user_id,
                u.username AS user_username,
                u.full_name AS user_full_name
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al.user_id
            WHERE {where_sql}
            ORDER BY al.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).fetchall()

    items = [
        AuditLogEntry(
            id=r[0],
            created_at=r[1],
            entity_type=r[2],
            entity_id=r[3],
            entity_name=r[4],
            shop_id=r[5],
            action=str(r[6]) if r[6] else "unknown",
            changes=r[7],
            ip_address=None,
            user_id=r[8],
            user_username=r[9],
            user_full_name=r[10],
        )
        for r in rows
    ]

    return AuditLogListResponse(items=items, total=total)
