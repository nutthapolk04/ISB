"""
Stock card report tests — GET /api/v1/reports/stock-card

Critical bug fixed: endpoint previously queried stock_movements (empty)
instead of shop_movements (the live audit table written by checkout/void).

These tests verify the endpoint reads ShopMovement correctly and computes
opening/closing balances from real data.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from app.core.security import create_access_token
from app.models.shop import MovementType, ShopMovement, ShopProduct


# ── Helpers ───────────────────────────────────────────────────────────────────

def _admin_headers(admin) -> dict:
    tok = create_access_token({"sub": str(admin.id), "email": admin.email})
    return {"Authorization": f"Bearer {tok}"}


def _movement(db, product_id: int, shop_id: str, user_id: int,
              qty: int, stock_before: int, stock_after: int,
              mtype: MovementType = MovementType.receive,
              ref: str = "TEST", ts: datetime | None = None):
    m = ShopMovement(
        date=date.today(),
        product_id=product_id,
        product_name="test",
        shop_id=shop_id,
        type=mtype,
        quantity=qty,
        stock_before=stock_before,
        stock_after=stock_after,
        created_by=user_id,
        reference=ref,
        created_at=ts or datetime.now(timezone.utc),
    )
    db.add(m)
    return m


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_stock_card_no_movements(client_pos, db_session_pos, pos_seed):
    """No movements in range → rows is empty, balances fallback to current stock."""
    p1 = pos_seed["p1"]  # stock = 100
    admin = pos_seed["admin"]

    res = client_pos.get(
        f"/api/v1/reports/stock-card"
        f"?product_variant_id={p1.id}&date_from=2026-01-01&date_to=2026-01-31",
        headers=_admin_headers(admin),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["rows"] == []
    assert body["closing_balance"] == body["opening_balance"]


def test_stock_card_movements_within_range(client_pos, db_session_pos, pos_seed):
    """Movements inside the date range appear in rows with correct running balance."""
    p1 = pos_seed["p1"]
    admin = pos_seed["admin"]

    # Receive 50 → stock 0→50
    _movement(db_session_pos, p1.id, "coop", admin.id,
              qty=50, stock_before=0, stock_after=50,
              mtype=MovementType.receive, ref="PO-001",
              ts=datetime(2026, 5, 10, 8, 0, tzinfo=timezone.utc))
    # Sale 10 → stock 50→40
    _movement(db_session_pos, p1.id, "coop", admin.id,
              qty=10, stock_before=50, stock_after=40,
              mtype=MovementType.sale, ref="RCT-100",
              ts=datetime(2026, 5, 10, 9, 0, tzinfo=timezone.utc))
    db_session_pos.commit()

    res = client_pos.get(
        f"/api/v1/reports/stock-card"
        f"?product_variant_id={p1.id}&date_from=2026-05-01&date_to=2026-05-31",
        headers=_admin_headers(admin),
    )
    assert res.status_code == 200, res.text
    body = res.json()

    assert len(body["rows"]) == 2
    # First row: receive +50
    assert body["rows"][0]["movement_type"] == "receive"
    assert body["rows"][0]["quantity"] == 50
    assert body["rows"][0]["running_balance"] == 50
    assert body["rows"][0]["reference"] == "PO-001"
    # Second row: sale −10
    assert body["rows"][1]["movement_type"] == "sale"
    assert body["rows"][1]["quantity"] == -10
    assert body["rows"][1]["running_balance"] == 40

    assert body["closing_balance"] == 40


def test_stock_card_opening_balance_from_prior_movements(client_pos, db_session_pos, pos_seed):
    """Opening balance is the stock_after of the last movement BEFORE date_from."""
    p2 = pos_seed["p2"]
    admin = pos_seed["admin"]

    # Movement before the query window
    _movement(db_session_pos, p2.id, "coop", admin.id,
              qty=80, stock_before=120, stock_after=200,
              mtype=MovementType.receive, ref="PO-PRE",
              ts=datetime(2026, 4, 30, 23, 59, tzinfo=timezone.utc))
    # Movement inside window
    _movement(db_session_pos, p2.id, "coop", admin.id,
              qty=20, stock_before=200, stock_after=180,
              mtype=MovementType.sale, ref="RCT-200",
              ts=datetime(2026, 5, 5, 10, 0, tzinfo=timezone.utc))
    db_session_pos.commit()

    res = client_pos.get(
        f"/api/v1/reports/stock-card"
        f"?product_variant_id={p2.id}&date_from=2026-05-01&date_to=2026-05-31",
        headers=_admin_headers(admin),
    )
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["opening_balance"] == 200   # stock_after of pre-window movement
    assert len(body["rows"]) == 1
    assert body["rows"][0]["movement_type"] == "sale"
    assert body["rows"][0]["quantity"] == -20
    assert body["closing_balance"] == 180


def test_stock_card_product_not_found(client_pos, pos_seed):
    """Non-existent product_variant_id → 404."""
    admin = pos_seed["admin"]
    res = client_pos.get(
        "/api/v1/reports/stock-card?product_variant_id=99999&date_from=2026-01-01&date_to=2026-01-31",
        headers=_admin_headers(admin),
    )
    assert res.status_code == 404


def test_stock_card_movements_outside_range_excluded(client_pos, db_session_pos, pos_seed):
    """Movements outside the query window must not appear in rows."""
    p3 = pos_seed["p3"]
    admin = pos_seed["admin"]

    _movement(db_session_pos, p3.id, "coop", admin.id,
              qty=30, stock_before=120, stock_after=150,
              mtype=MovementType.receive, ref="PO-MAY",
              ts=datetime(2026, 5, 15, 10, 0, tzinfo=timezone.utc))
    # This one is outside the window
    _movement(db_session_pos, p3.id, "coop", admin.id,
              qty=5, stock_before=150, stock_after=145,
              mtype=MovementType.sale, ref="RCT-JUNE",
              ts=datetime(2026, 6, 1, 10, 0, tzinfo=timezone.utc))
    db_session_pos.commit()

    res = client_pos.get(
        f"/api/v1/reports/stock-card"
        f"?product_variant_id={p3.id}&date_from=2026-05-01&date_to=2026-05-31",
        headers=_admin_headers(admin),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["rows"]) == 1
    assert body["rows"][0]["reference"] == "PO-MAY"


def test_stock_card_unauthorized(client_pos, pos_seed):
    """No token → 403."""
    p1 = pos_seed["p1"]
    res = client_pos.get(
        f"/api/v1/reports/stock-card?product_variant_id={p1.id}&date_from=2026-01-01&date_to=2026-01-31"
    )
    assert res.status_code in (401, 403)
