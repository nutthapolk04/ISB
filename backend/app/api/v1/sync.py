"""
PowerSchool Sync API (Phase 3.5 — mock).

POST /api/v1/sync/powerschool   trigger mock sync
GET  /api/v1/sync/logs          list sync runs (paginated)
GET  /api/v1/sync/stats         aggregate for dashboard (last 30 days)
"""
import logging
from typing import List, Optional
from datetime import datetime, timedelta, timezone, date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.database import get_db
from app.api.deps import require_role
from app.models.user import User
from app.models.sync_log import SyncLog
from app.schemas.sync import (
    SyncRequest,
    SyncResponse,
    SyncLogItem,
    SyncStats,
    DailyBucket,
)
from app.services.powerschool_sync import run_sync

logger = logging.getLogger(__name__)
router = APIRouter()


_VALID_ROLES = {"student", "parent", "staff", "admin", "manager", "cashier"}


@router.post("/powerschool", response_model=SyncResponse)
def trigger_sync(
    payload: SyncRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Trigger a mock PowerSchool sync synchronously and return the result."""
    target = [r for r in (payload.target_roles or []) if r in _VALID_ROLES]
    if not target:
        raise HTTPException(status_code=400, detail="At least one valid target role is required")

    try:
        log = run_sync(
            db=db,
            triggered_by_id=current_user.id,
            sync_type=payload.sync_type,
            target_roles=target,
        )
    except Exception as e:
        logger.exception("PowerSchool sync failed")
        raise HTTPException(status_code=500, detail=f"Sync crashed: {e}")

    return SyncResponse(
        sync_log_id=log.id,
        status=log.status,
        sync_type=log.sync_type,
        target_roles=log.target_roles,
        records_total=log.records_total,
        records_success=log.records_success,
        records_failed=log.records_failed,
        started_at=log.started_at,
        finished_at=log.finished_at,
        error_log=log.error_log,
    )


@router.get("/logs", response_model=List[SyncLogItem])
def list_sync_logs(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    rows = (
        db.query(SyncLog)
        .order_by(SyncLog.started_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    out: List[SyncLogItem] = []
    for r in rows:
        name = None
        if r.triggered_by:
            u = db.query(User).filter(User.id == r.triggered_by).first()
            name = u.full_name if u else None
        out.append(SyncLogItem(
            id=r.id,
            sync_type=r.sync_type,
            target_roles=r.target_roles or [],
            triggered_by_name=name,
            started_at=r.started_at,
            finished_at=r.finished_at,
            status=r.status,
            records_total=r.records_total,
            records_success=r.records_success,
            records_failed=r.records_failed,
            error_log=r.error_log,
        ))
    return out


@router.get("/stats", response_model=SyncStats)
def sync_stats(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Aggregate totals
    total_runs = db.query(func.count(SyncLog.id)).filter(SyncLog.started_at >= since).scalar() or 0
    total_success = db.query(func.coalesce(func.sum(SyncLog.records_success), 0)).filter(SyncLog.started_at >= since).scalar() or 0
    total_failed = db.query(func.coalesce(func.sum(SyncLog.records_failed), 0)).filter(SyncLog.started_at >= since).scalar() or 0

    # Last run
    last = db.query(SyncLog).order_by(SyncLog.started_at.desc()).first()

    # Daily buckets
    date_col = func.date(SyncLog.started_at).label("d")
    rows = (
        db.query(
            date_col,
            func.coalesce(func.sum(SyncLog.records_success), 0),
            func.coalesce(func.sum(SyncLog.records_failed), 0),
        )
        .filter(SyncLog.started_at >= since)
        .group_by(date_col)
        .order_by(date_col)
        .all()
    )
    daily = []
    for d, succ, fail in rows:
        # d may already be a date; normalize
        if isinstance(d, datetime):
            d = d.date()
        daily.append(DailyBucket(date=d, success=int(succ or 0), failed=int(fail or 0)))

    return SyncStats(
        total_runs=int(total_runs),
        total_success=int(total_success),
        total_failed=int(total_failed),
        last_sync_at=last.started_at if last else None,
        last_sync_status=last.status if last else None,
        daily=daily,
    )
