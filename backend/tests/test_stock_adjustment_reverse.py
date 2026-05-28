"""
Tests for stock adjustment reverse — POST /api/v1/shops/{shop_id}/movements/{movement_id}/reverse

Covers:
- Happy path (positive + negative original deltas)
- Validation: only adjustments, no double-reverse, no reverse-of-reversal
- RBAC: cashier forbidden, manager scoped to own shop
- Service-level wiring: reverses_id / reversed_by_id set on both rows
- 404 for missing movement
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from app.core.security import create_access_token, get_password_hash
from app.models.shop import (
    MovementType,
    Shop,
    ShopMovement,
    ShopProduct,
)
from app.models.user import User
from app.services.inventory_service import InventoryService


# ── Helpers ───────────────────────────────────────────────────────────────────


def _headers(user: User) -> dict:
    tok = create_access_token({"sub": str(user.id), "email": user.email})
    return {"Authorization": f"Bearer {tok}"}


def _make_user(db, *, username: str, role: str, shop_id: str | None = None) -> User:
    u = User(
        username=username,
        email=f"{username}@test.local",
        full_name=username.replace("_", " ").title(),
        hashed_password=get_password_hash("pw"),
        role=role,
        is_active=True,
        is_superuser=(role == "admin"),
        shop_id=shop_id,
        status="active",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _adjust(client, headers, shop_id: str, product_id: int, delta: int, reason: str = "Test adjust") -> None:
    """Call the public adjust endpoint to create a real adjustment movement."""
    res = client.post(
        f"/api/v1/shops/{shop_id}/adjust",
        json={"product_id": product_id, "delta": delta, "reason": reason},
        headers=headers,
    )
    assert res.status_code == 200, res.text


def _latest_adjustment(db, shop_id: str, product_id: int) -> ShopMovement:
    return (
        db.query(ShopMovement)
        .filter(
            ShopMovement.shop_id == shop_id,
            ShopMovement.product_id == product_id,
            ShopMovement.type == MovementType.adjustment,
        )
        .order_by(ShopMovement.id.desc())
        .first()
    )


# ── Happy path ───────────────────────────────────────────────────────────────


def test_reverse_positive_adjustment_returns_stock_to_original(
    client_pos, db_session_pos, pos_seed
):
    """+10 adjust → reverse → stock back to 100, two linked adjustments exist."""
    p1 = pos_seed["p1"]  # stock = 100
    coop_mgr = _make_user(db_session_pos, username="coop_mgr", role="manager", shop_id="coop")

    _adjust(client_pos, _headers(coop_mgr), "coop", p1.id, delta=10)
    db_session_pos.refresh(p1)
    assert p1.stock == 110, "adjust step should bump stock by 10"

    original = _latest_adjustment(db_session_pos, "coop", p1.id)
    assert original.quantity == 10

    res = client_pos.post(
        f"/api/v1/shops/coop/movements/{original.id}/reverse",
        headers=_headers(coop_mgr),
    )
    assert res.status_code == 200, res.text
    body = res.json()

    # Returned movement is the reversal — opposite delta, links back to original.
    assert body["quantity"] == -10
    assert body["reverses_id"] == original.id
    assert body["type"] == "adjustment"
    assert body["note"].startswith(f"Reverse of #{original.id}:")

    db_session_pos.refresh(p1)
    db_session_pos.refresh(original)
    assert p1.stock == 100, "reverse step should bring stock back to original"
    assert original.reversed_by_id == body["id"]


def test_reverse_negative_adjustment_restores_stock(
    client_pos, db_session_pos, pos_seed
):
    """-30 adjust → reverse → stock back to 100."""
    p1 = pos_seed["p1"]  # stock = 100
    coop_mgr = _make_user(db_session_pos, username="coop_mgr", role="manager", shop_id="coop")

    _adjust(client_pos, _headers(coop_mgr), "coop", p1.id, delta=-30, reason="Damage")
    db_session_pos.refresh(p1)
    assert p1.stock == 70

    original = _latest_adjustment(db_session_pos, "coop", p1.id)
    assert original.quantity == -30

    res = client_pos.post(
        f"/api/v1/shops/coop/movements/{original.id}/reverse",
        headers=_headers(coop_mgr),
    )
    assert res.status_code == 200, res.text
    assert res.json()["quantity"] == 30

    db_session_pos.refresh(p1)
    assert p1.stock == 100


# ── Validation ───────────────────────────────────────────────────────────────


def test_reverse_404_when_movement_missing(client_pos, db_session_pos, pos_seed):
    coop_mgr = _make_user(db_session_pos, username="coop_mgr", role="manager", shop_id="coop")
    res = client_pos.post(
        "/api/v1/shops/coop/movements/999999/reverse",
        headers=_headers(coop_mgr),
    )
    assert res.status_code == 404


def test_reverse_rejects_non_adjustment_movement(
    client_pos, db_session_pos, pos_seed
):
    """Receive-type movements cannot be reversed via this endpoint."""
    p1 = pos_seed["p1"]
    coop_mgr = _make_user(db_session_pos, username="coop_mgr", role="manager", shop_id="coop")

    # Insert a `receive` movement directly (no public endpoint for arbitrary type).
    mv = ShopMovement(
        date=date.today(),
        product_id=p1.id,
        product_name=p1.name,
        shop_id="coop",
        type=MovementType.receive,
        quantity=20,
        stock_before=100,
        stock_after=120,
        created_by=coop_mgr.id,
    )
    db_session_pos.add(mv)
    db_session_pos.commit()
    db_session_pos.refresh(mv)

    res = client_pos.post(
        f"/api/v1/shops/coop/movements/{mv.id}/reverse",
        headers=_headers(coop_mgr),
    )
    assert res.status_code == 422
    assert "adjustment" in res.json()["detail"].lower()


def test_reverse_rejects_double_reverse(client_pos, db_session_pos, pos_seed):
    """An adjustment can only be reversed once."""
    p1 = pos_seed["p1"]
    coop_mgr = _make_user(db_session_pos, username="coop_mgr", role="manager", shop_id="coop")

    _adjust(client_pos, _headers(coop_mgr), "coop", p1.id, delta=5)
    original = _latest_adjustment(db_session_pos, "coop", p1.id)

    res1 = client_pos.post(
        f"/api/v1/shops/coop/movements/{original.id}/reverse",
        headers=_headers(coop_mgr),
    )
    assert res1.status_code == 200

    res2 = client_pos.post(
        f"/api/v1/shops/coop/movements/{original.id}/reverse",
        headers=_headers(coop_mgr),
    )
    assert res2.status_code == 422
    assert "already been reversed" in res2.json()["detail"].lower()


def test_reverse_rejects_reversal_entry_itself(
    client_pos, db_session_pos, pos_seed
):
    """The mirror entry produced by a reverse cannot itself be reversed."""
    p1 = pos_seed["p1"]
    coop_mgr = _make_user(db_session_pos, username="coop_mgr", role="manager", shop_id="coop")

    _adjust(client_pos, _headers(coop_mgr), "coop", p1.id, delta=7)
    original = _latest_adjustment(db_session_pos, "coop", p1.id)

    res = client_pos.post(
        f"/api/v1/shops/coop/movements/{original.id}/reverse",
        headers=_headers(coop_mgr),
    )
    assert res.status_code == 200
    reversal_id = res.json()["id"]

    # Trying to reverse the reversal itself must fail.
    res2 = client_pos.post(
        f"/api/v1/shops/coop/movements/{reversal_id}/reverse",
        headers=_headers(coop_mgr),
    )
    assert res2.status_code == 422
    assert "reversal" in res2.json()["detail"].lower()


# ── RBAC ─────────────────────────────────────────────────────────────────────


def test_reverse_forbidden_for_cashier(client_pos, db_session_pos, pos_seed):
    """Cashiers must not be able to reverse adjustments (anti-fraud rule)."""
    p1 = pos_seed["p1"]
    coop_mgr = _make_user(db_session_pos, username="coop_mgr", role="manager", shop_id="coop")
    cashier = _make_user(db_session_pos, username="cashier1", role="cashier", shop_id="coop")

    _adjust(client_pos, _headers(coop_mgr), "coop", p1.id, delta=3)
    original = _latest_adjustment(db_session_pos, "coop", p1.id)

    res = client_pos.post(
        f"/api/v1/shops/coop/movements/{original.id}/reverse",
        headers=_headers(cashier),
    )
    assert res.status_code == 403


def test_reverse_forbidden_for_manager_of_another_shop(
    client_pos, db_session_pos, pos_seed
):
    """Managers can only reverse movements in their own shop."""
    p1 = pos_seed["p1"]
    coop_mgr = _make_user(db_session_pos, username="coop_mgr", role="manager", shop_id="coop")

    # Add a separate shop and seat a manager there.
    other = Shop(id="bookstore", name="Bookstore", shop_type="avg_cost", is_active=True)
    db_session_pos.add(other)
    db_session_pos.commit()
    bookstore_mgr = _make_user(
        db_session_pos, username="bookstore_mgr", role="manager", shop_id="bookstore"
    )

    _adjust(client_pos, _headers(coop_mgr), "coop", p1.id, delta=4)
    original = _latest_adjustment(db_session_pos, "coop", p1.id)

    res = client_pos.post(
        f"/api/v1/shops/coop/movements/{original.id}/reverse",
        headers=_headers(bookstore_mgr),
    )
    assert res.status_code == 403


# ── Service-level: link wiring ────────────────────────────────────────────────


def test_service_wires_reverses_id_and_reversed_by_id(db_session_pos, pos_seed):
    """Direct service call must set both FK columns on both rows."""
    p1 = pos_seed["p1"]
    coop_mgr = _make_user(db_session_pos, username="coop_mgr", role="manager", shop_id="coop")
    shop = db_session_pos.query(Shop).filter(Shop.id == "coop").first()

    # Create the original adjustment via the service.
    InventoryService.adjust_stock(
        db=db_session_pos,
        shop=shop,
        product=p1,
        delta=8,
        reason="Original",
        user_id=coop_mgr.id,
    )
    db_session_pos.commit()

    original = _latest_adjustment(db_session_pos, "coop", p1.id)
    assert original is not None

    new_mv = InventoryService.reverse_adjustment(
        db=db_session_pos,
        shop=shop,
        movement=original,
        user_id=coop_mgr.id,
    )
    db_session_pos.commit()
    db_session_pos.refresh(original)
    db_session_pos.refresh(new_mv)

    assert new_mv.quantity == -8
    assert new_mv.reverses_id == original.id
    assert original.reversed_by_id == new_mv.id
    assert new_mv.note.startswith(f"Reverse of #{original.id}:")
