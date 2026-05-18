"""
Canteen API Routes
POST /api/v1/canteen/{shop_id}/close-day  — summarise today's receipts and return EOD report
"""
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

TZ_BKK = ZoneInfo("Asia/Bangkok")
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role, user_can_access_shop
from app.core.database import get_db
from app.models.receipt import Receipt, ReceiptItem, ReceiptStatus
from app.models.user import User

router = APIRouter()


# ── Schema ───────────────────────────────────────────────────────────────────

class CloseDaySummary(BaseModel):
    shop_id: str
    date: str                        # ISO date string, e.g. "2026-05-15"
    total_orders: int
    total_revenue: float
    item_count: int
    payment_breakdown: Dict[str, float]


# ── Endpoint ─────────────────────────────────────────────────────────────────

@router.post(
    "/{shop_id}/close-day",
    response_model=CloseDaySummary,
    summary="Close day for a canteen shop",
    description=(
        "Aggregate all active receipts for today at the given shop and return "
        "an end-of-day summary. Allowed roles: admin, manager."
    ),
)
def close_day(
    shop_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """Return EOD summary for *shop_id* scoped to today (UTC)."""

    # Shop-scope check: admins see all, managers only their own shop.
    if not user_can_access_shop(current_user, shop_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"User {current_user.username} "
                f"(shop={getattr(current_user, 'shop_id', None)}) "
                f"is not authorized to close day for shop '{shop_id}'"
            ),
        )

    today = datetime.now(TZ_BKK).date()
    start = datetime.combine(today, time.min, tzinfo=TZ_BKK)
    end = datetime.combine(today, time.max, tzinfo=TZ_BKK)

    # ── Active receipts for this shop today ──────────────────────────────────
    receipts = (
        db.query(Receipt)
        .filter(
            Receipt.shop_id == shop_id,
            Receipt.status == ReceiptStatus.ACTIVE,
            Receipt.transaction_date >= start,
            Receipt.transaction_date <= end,
        )
        .all()
    )

    if not receipts:
        return CloseDaySummary(
            shop_id=shop_id,
            date=today.isoformat(),
            total_orders=0,
            total_revenue=0.0,
            item_count=0,
            payment_breakdown={},
        )

    receipt_ids = [r.id for r in receipts]

    # ── Total revenue ─────────────────────────────────────────────────────────
    total_revenue = sum(float(r.total) for r in receipts)

    # ── Item count (sum of quantities across all line items) ──────────────────
    item_count_row = (
        db.query(func.sum(ReceiptItem.quantity))
        .filter(ReceiptItem.receipt_id.in_(receipt_ids))
        .scalar()
    )
    item_count = int(item_count_row or 0)

    # ── Payment breakdown: method → total ─────────────────────────────────────
    payment_agg = (
        db.query(
            Receipt.payment_method,
            func.sum(Receipt.total).label("method_total"),
        )
        .filter(Receipt.id.in_(receipt_ids))
        .group_by(Receipt.payment_method)
        .all()
    )
    payment_breakdown: Dict[str, float] = {}
    for method, method_total in payment_agg:
        method_name = method.value if hasattr(method, "value") else str(method)
        payment_breakdown[method_name] = float(method_total or 0)

    return CloseDaySummary(
        shop_id=shop_id,
        date=today.isoformat(),
        total_orders=len(receipts),
        total_revenue=total_revenue,
        item_count=item_count,
        payment_breakdown=payment_breakdown,
    )
