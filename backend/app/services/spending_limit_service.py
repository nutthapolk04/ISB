"""
Spending Limit Service

Single source of truth for "how much has this payer spent today in a given
spending group", and for the advisory-lock helper that prevents two POS
terminals from simultaneously pushing a student past their limit.

Critical invariants:
- Day boundary: DB-side (now() AT TIME ZONE 'Asia/Bangkok')::date — never
  Python datetime.now() which can have clock-skew vs the database.
- Filter on receipts.spending_group_id (snapshot column), NOT shops.spending_group_id,
  so re-grouping a shop mid-day never re-attributes historical receipts.
- Sum only ACTIVE receipts — VOIDED receipts drop out of the sum automatically.
- pg_advisory_xact_lock prevents two terminals from racing through the limit
  check simultaneously for the same payer + group.
"""
from __future__ import annotations

import hashlib
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.receipt import Receipt, ReceiptStatus
from app.core.errors import BusinessRuleError


# ---------------------------------------------------------------------------
# Advisory lock helper
# ---------------------------------------------------------------------------

def _lock_key_int(s: str) -> int:
    """Map an arbitrary string to a 32-bit signed int for pg_advisory_xact_lock."""
    # MD5 → take the first 4 bytes → big-endian signed int32
    digest = hashlib.md5(s.encode()).digest()[:4]
    value = int.from_bytes(digest, "big")
    # Convert to signed int32
    if value >= 0x80000000:
        value -= 0x100000000
    return value


def acquire_payer_group_lock(
    db: Session,
    *,
    payer_customer_id: Optional[int],
    payer_user_id: Optional[int],
    payer_department_id: Optional[int],
    spending_group_id: int,
) -> None:
    """Acquire a per-transaction advisory lock keyed on (payer identity, group).

    pg_advisory_xact_lock(int4, int4) takes two 32-bit keys.
    - key1: stable hash of the payer identity string
    - key2: spending_group_id clamped to int32

    The lock is released automatically when the transaction commits or rolls back.
    This prevents two POS terminals from both passing the limit check before
    either receipt is persisted.
    """
    # Build a stable payer string — only one of the three should be non-None
    payer_str = (
        f"c{payer_customer_id}" if payer_customer_id is not None
        else f"u{payer_user_id}" if payer_user_id is not None
        else f"d{payer_department_id}" if payer_department_id is not None
        else "unknown"
    )
    key1 = _lock_key_int(f"spending_limit:{payer_str}")
    key2 = spending_group_id & 0x7FFFFFFF  # clamp to signed int32 positive range
    db.execute(
        text("SELECT pg_advisory_xact_lock(:k1, :k2)"),
        {"k1": key1, "k2": key2},
    )


# ---------------------------------------------------------------------------
# Aggregation query
# ---------------------------------------------------------------------------

def compute_spent_today(
    db: Session,
    *,
    payer_customer_id: Optional[int] = None,
    payer_user_id: Optional[int] = None,
    payer_department_id: Optional[int] = None,
    spending_group_id: int,
) -> Decimal:
    """Return the total amount this payer has spent today in the given group.

    Uses DB-side day boundary so the result is correct regardless of the
    app-server timezone. Filters on receipts.spending_group_id (snapshot),
    not shops.spending_group_id.

    Returns Decimal(0) when no ACTIVE receipts match.
    """
    # Build payer filter for the three polymorphic columns. Exactly one of the
    # three should be non-None for a normal checkout; we match whichever is set.
    payer_conditions: list[str] = []
    params: dict = {"gid": spending_group_id}

    if payer_customer_id is not None:
        payer_conditions.append("r.customer_id = :cid")
        params["cid"] = payer_customer_id
    if payer_user_id is not None:
        payer_conditions.append("r.payer_user_id = :uid")
        params["uid"] = payer_user_id
    if payer_department_id is not None:
        payer_conditions.append("r.payer_department_id = :did")
        params["did"] = payer_department_id

    if not payer_conditions:
        # No payer identified — cannot compute; return 0 (caller decides how to handle)
        return Decimal("0")

    payer_clause = " OR ".join(payer_conditions)

    sql = text(f"""
        SELECT COALESCE(SUM(r.total), 0)
        FROM receipts r
        WHERE r.status = 'ACTIVE'
          AND r.spending_group_id = :gid
          AND (r.transaction_date AT TIME ZONE 'Asia/Bangkok')::date
              = (now() AT TIME ZONE 'Asia/Bangkok')::date
          AND ({payer_clause})
    """)

    result = db.execute(sql, params).scalar()
    return Decimal(str(result)) if result is not None else Decimal("0")


# ---------------------------------------------------------------------------
# Enforcement helper (called from pos_service)
# ---------------------------------------------------------------------------

def enforce_spending_limit(
    db: Session,
    *,
    shop,  # Shop ORM instance
    total: float,
    payer_customer_id: Optional[int] = None,
    payer_user_id: Optional[int] = None,
    payer_department_id: Optional[int] = None,
) -> None:
    """Check the spending limit for the given shop + payer + purchase total.

    Raises BusinessRuleError (→ HTTP 400) on violation. Returns None on pass.

    Caller must have an open transaction — the advisory lock acquired here is
    released at commit/rollback.
    """
    if shop.spending_group_id is None:
        raise BusinessRuleError(
            code="SHOP_NOT_ASSIGNED_SPENDING_GROUP",
            params={"shop_id": shop.id, "shop_name": shop.name},
            message=(
                f"Shop '{shop.name}' has not been assigned a Spending Group. "
                "Please contact admin."
            ),
        )

    # Lazy import to avoid circular dependency at module load time
    from app.models.spending_group import SpendingGroup

    group: SpendingGroup | None = db.query(SpendingGroup).filter(
        SpendingGroup.id == shop.spending_group_id
    ).first()

    if group is None:
        # Data integrity issue — group was deleted while shops still reference it.
        # Treat as unassigned to avoid a silent 500.
        raise BusinessRuleError(
            code="SHOP_NOT_ASSIGNED_SPENDING_GROUP",
            params={"shop_id": shop.id, "shop_name": shop.name},
            message=(
                f"Shop '{shop.name}' references a Spending Group that no longer exists. "
                "Please contact admin."
            ),
        )

    # Decision #4: is_active=False → skip enforcement entirely
    if not group.is_active:
        return

    # Acquire per-transaction advisory lock to prevent two-terminal race
    acquire_payer_group_lock(
        db,
        payer_customer_id=payer_customer_id,
        payer_user_id=payer_user_id,
        payer_department_id=payer_department_id,
        spending_group_id=group.id,
    )

    spent = compute_spent_today(
        db,
        payer_customer_id=payer_customer_id,
        payer_user_id=payer_user_id,
        payer_department_id=payer_department_id,
        spending_group_id=group.id,
    )

    total_dec = Decimal(str(total))
    limit_dec = Decimal(str(group.daily_limit))

    if spent + total_dec > limit_dec:
        remaining = max(Decimal("0"), limit_dec - spent)
        raise BusinessRuleError(
            code="DAILY_LIMIT_EXCEEDED",
            params={
                "group_code": group.code,
                "group_name_en": group.name_en,
                "group_name_th": group.name_th,
                "limit": float(limit_dec),
                "spent_today": float(spent),
                "remaining": float(remaining),
                "attempted": float(total_dec),
            },
            message=(
                f"Daily limit reached for {group.name_en}. "
                f"Remaining today: ฿{remaining:.2f}"
            ),
        )
