"""
Negative-balance policy tests — covers the type-aware guard in
WalletService.transfer_within_family() plus the SettingsService cache
behaviour.

Strategy: exercise the service layer directly (no HTTP). The same guard logic
runs at POS checkout, so unit-testing transfer is enough to validate the
behavioural contract.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.core.errors import BusinessRuleError
from app.models.customer import Customer, CustomerType, CustomerTypeEnum
from app.models.department import Department
from app.models.parent_child_link import ParentChildLink
from app.models.user import User
from app.models.wallet import Wallet
from app.services.settings_service import (
    KNOWN_FLAGS,
    SettingsService,
    _invalidate as _invalidate_settings_cache,
)
from app.services.wallet_service import WalletService


# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def reset_settings_cache():
    """Each test starts with a fresh empty cache so flag changes don't leak."""
    _invalidate_settings_cache()
    yield
    _invalidate_settings_cache()


@pytest.fixture()
def family(db_session):
    """A parent user, a child customer, and a sibling customer — wired into
    parent_child_links so transfer_within_family auth check passes."""
    customer_type = CustomerType(
        type_name=CustomerTypeEnum.student,
        default_price_level="retail",
    )
    db_session.add(customer_type)
    db_session.flush()

    parent = User(
        username="parent_user",
        email="parent@isb.local",
        full_name="Parent User",
        hashed_password="x",
        role="parent",
        is_active=True,
        is_superuser=False,
        status="active",
    )
    db_session.add(parent)
    db_session.flush()

    child = Customer(
        customer_code="C001",
        name="Child One",
        customer_type_id=customer_type.id,
        customer_kind="student",
    )
    sibling = Customer(
        customer_code="C002",
        name="Child Two",
        customer_type_id=customer_type.id,
        customer_kind="student",
    )
    db_session.add_all([child, sibling])
    db_session.flush()

    db_session.add_all([
        ParentChildLink(parent_user_id=parent.id, child_customer_id=child.id),
        ParentChildLink(parent_user_id=parent.id, child_customer_id=sibling.id),
    ])

    parent_wallet = Wallet(user_id=parent.id, balance=Decimal("50.00"))
    child_wallet = Wallet(customer_id=child.id, balance=Decimal("50.00"))
    sibling_wallet = Wallet(customer_id=sibling.id, balance=Decimal("0.00"))
    db_session.add_all([parent_wallet, child_wallet, sibling_wallet])
    db_session.flush()

    department = Department(
        department_code="OPS",
        department_name="Operations",
        annual_budget=Decimal("100000.00"),
        current_year=2026,
    )
    db_session.add(department)
    db_session.flush()
    dept_wallet = Wallet(department_id=department.id, balance=Decimal("50.00"))
    db_session.add(dept_wallet)
    db_session.commit()

    return {
        "parent": parent,
        "child": child,
        "sibling": sibling,
        "parent_wallet": parent_wallet,
        "child_wallet": child_wallet,
        "sibling_wallet": sibling_wallet,
        "department": department,
        "dept_wallet": dept_wallet,
    }


# ── SettingsService ─────────────────────────────────────────────────────────


def test_settings_service_get_bool_returns_default_when_missing(db_session):
    assert SettingsService.get_bool(db_session, "allow_negative_user_wallet", default=False) is False
    assert SettingsService.get_bool(db_session, "allow_negative_user_wallet", default=True) is True


def test_settings_service_set_updates_cache_immediately(db_session):
    SettingsService.set(db_session, "allow_negative_user_wallet", True, user_id=None)
    assert SettingsService.get_bool(db_session, "allow_negative_user_wallet", default=False) is True

    SettingsService.set(db_session, "allow_negative_user_wallet", False, user_id=None)
    assert SettingsService.get_bool(db_session, "allow_negative_user_wallet", default=True) is False


def test_settings_service_known_flags_listed(db_session):
    listed = SettingsService.list_known(db_session)
    assert "allow_negative_user_wallet" in listed
    assert "allow_negative_customer_wallet" in listed
    # Defaults match the catalog
    assert listed["allow_negative_user_wallet"] == KNOWN_FLAGS["allow_negative_user_wallet"]


# ── User wallet guard ───────────────────────────────────────────────────────


def test_transfer_user_wallet_blocks_when_flag_off(db_session, family):
    """Parent (user wallet) ฿50 → child (customer wallet) ฿0 — transfer ฿80 must block."""
    with pytest.raises(BusinessRuleError) as exc:
        WalletService.transfer_within_family(
            db_session,
            from_wallet_id=family["parent_wallet"].id,
            to_wallet_id=family["sibling_wallet"].id,
            amount=80.0,
            initiator_user_id=family["parent"].id,
            initiator_is_admin=False,
        )
    assert exc.value.code == "INSUFFICIENT_USER_WALLET_TRANSFER"


def test_transfer_user_wallet_allows_when_flag_on(db_session, family):
    SettingsService.set(db_session, "allow_negative_user_wallet", True, user_id=None)
    debit_tx, credit_tx = WalletService.transfer_within_family(
        db_session,
        from_wallet_id=family["parent_wallet"].id,
        to_wallet_id=family["sibling_wallet"].id,
        amount=80.0,
        initiator_user_id=family["parent"].id,
        initiator_is_admin=False,
    )
    assert float(debit_tx.balance_after) == -30.0
    assert float(credit_tx.balance_after) == 80.0


# ── Customer wallet guard ───────────────────────────────────────────────────


def test_transfer_customer_wallet_blocks_with_no_overdraft(db_session, family):
    """Child wallet ฿50, transfer ฿80 to sibling, no overdraft set → block."""
    with pytest.raises(BusinessRuleError) as exc:
        WalletService.transfer_within_family(
            db_session,
            from_wallet_id=family["child_wallet"].id,
            to_wallet_id=family["sibling_wallet"].id,
            amount=80.0,
            initiator_user_id=family["parent"].id,
            initiator_is_admin=False,
        )
    assert exc.value.code == "EXCEEDS_NEGATIVE_CREDIT_LIMIT_TRANSFER"
    assert exc.value.params["maxOverdraft"] == 0


def test_transfer_customer_wallet_allows_within_overdraft(db_session, family):
    """Child wallet ฿50, overdraft ฿100 set → can transfer up to ฿150 total."""
    family["child"].negative_credit_limit = Decimal("100.00")
    db_session.commit()

    debit_tx, _ = WalletService.transfer_within_family(
        db_session,
        from_wallet_id=family["child_wallet"].id,
        to_wallet_id=family["sibling_wallet"].id,
        amount=80.0,
        initiator_user_id=family["parent"].id,
        initiator_is_admin=False,
    )
    assert float(debit_tx.balance_after) == -30.0


def test_transfer_customer_wallet_blocks_when_overdraft_exceeded(db_session, family):
    """Child wallet ฿50, overdraft ฿100, transfer ฿200 → would land at -150 < -100 → block."""
    family["child"].negative_credit_limit = Decimal("100.00")
    db_session.commit()

    with pytest.raises(BusinessRuleError) as exc:
        WalletService.transfer_within_family(
            db_session,
            from_wallet_id=family["child_wallet"].id,
            to_wallet_id=family["sibling_wallet"].id,
            amount=200.0,
            initiator_user_id=family["parent"].id,
            initiator_is_admin=False,
        )
    assert exc.value.code == "EXCEEDS_NEGATIVE_CREDIT_LIMIT_TRANSFER"


def test_transfer_customer_wallet_allows_when_global_flag_on(db_session, family):
    """Global flag ON → bypass per-customer limit, unrestricted negative."""
    SettingsService.set(db_session, "allow_negative_customer_wallet", True, user_id=None)

    debit_tx, _ = WalletService.transfer_within_family(
        db_session,
        from_wallet_id=family["child_wallet"].id,
        to_wallet_id=family["sibling_wallet"].id,
        amount=500.0,
        initiator_user_id=family["parent"].id,
        initiator_is_admin=False,
    )
    assert float(debit_tx.balance_after) == -450.0


# ── Department wallet — always allowed ──────────────────────────────────────


def test_transfer_department_wallet_always_allows_negative(db_session, family):
    """Department wallets are unrestricted — even with both flags OFF."""
    # Department wallet not normally reachable via parent-child auth — call as admin.
    debit_tx, _ = WalletService.transfer_within_family(
        db_session,
        from_wallet_id=family["dept_wallet"].id,
        to_wallet_id=family["child_wallet"].id,
        amount=500.0,
        initiator_user_id=family["parent"].id,
        initiator_is_admin=True,
    )
    assert float(debit_tx.balance_after) == -450.0
