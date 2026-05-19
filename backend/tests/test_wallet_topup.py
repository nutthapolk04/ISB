"""
Wallet top-up tests.

Confirms:
- QR / cash topup credits exact amount
- Credit card topup credits exact amount (3% is a display-only fee on the frontend;
  backend credits exactly what the intent says)
- Double-confirm is rejected (intent already confirmed)
- Confirm on unknown ref_code raises ValueError
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.models.payment_intent import PaymentIntent, PaymentIntentStatus
from app.models.wallet import Wallet, WalletTransaction
from app.services.wallet_service import WalletService


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture()
def wallet_setup(db_session_pos, pos_seed):
    """One admin user + a wallet for them."""
    admin = pos_seed["admin"]
    wallet = Wallet(user_id=admin.id, balance=Decimal("0.00"))
    db_session_pos.add(wallet)
    db_session_pos.commit()
    db_session_pos.refresh(wallet)
    return {"admin": admin, "wallet": wallet}


def _make_intent(db, wallet_id: int, amount: float, method: str = "qr_promptpay") -> PaymentIntent:
    intent = PaymentIntent(
        ref_code=f"TOP-TEST-{method[:3].upper()}-{amount:.0f}",
        wallet_id=wallet_id,
        amount=Decimal(str(amount)),
        payment_method=method,
        status=PaymentIntentStatus.pending,
    )
    db.add(intent)
    db.commit()
    db.refresh(intent)
    return intent


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_qr_topup_credits_exact_amount(db_session_pos, wallet_setup):
    admin = wallet_setup["admin"]
    wallet = wallet_setup["wallet"]
    intent = _make_intent(db_session_pos, wallet.id, 500.00, "qr_promptpay")

    WalletService.confirm_topup(db_session_pos, intent.ref_code, admin.id)

    db_session_pos.refresh(wallet)
    assert float(wallet.balance) == 500.00


def test_credit_card_topup_credits_exact_amount(db_session_pos, wallet_setup):
    """Backend credits the face value; 3% is shown as display fee on frontend only."""
    admin = wallet_setup["admin"]
    wallet = wallet_setup["wallet"]
    intent = _make_intent(db_session_pos, wallet.id, 100.00, "credit_card")

    WalletService.confirm_topup(db_session_pos, intent.ref_code, admin.id)

    db_session_pos.refresh(wallet)
    assert float(wallet.balance) == 100.00


def test_topup_creates_transaction_record(db_session_pos, wallet_setup):
    admin = wallet_setup["admin"]
    wallet = wallet_setup["wallet"]
    intent = _make_intent(db_session_pos, wallet.id, 200.00, "qr_promptpay")

    WalletService.confirm_topup(db_session_pos, intent.ref_code, admin.id)

    tx = (
        db_session_pos.query(WalletTransaction)
        .filter(WalletTransaction.wallet_id == wallet.id)
        .first()
    )
    assert tx is not None
    assert float(tx.amount) == 200.00
    assert float(tx.balance_after) == 200.00
    assert tx.transaction_type.value == "topup"


def test_double_confirm_raises(db_session_pos, wallet_setup):
    admin = wallet_setup["admin"]
    wallet = wallet_setup["wallet"]
    intent = _make_intent(db_session_pos, wallet.id, 150.00, "cash")

    WalletService.confirm_topup(db_session_pos, intent.ref_code, admin.id)

    with pytest.raises(ValueError, match="already"):
        WalletService.confirm_topup(db_session_pos, intent.ref_code, admin.id)


def test_confirm_unknown_ref_raises(db_session_pos, wallet_setup):
    admin = wallet_setup["admin"]
    with pytest.raises(ValueError, match="not found"):
        WalletService.confirm_topup(db_session_pos, "TOP-DOES-NOT-EXIST", admin.id)


def test_sequential_topups_accumulate(db_session_pos, wallet_setup):
    """Two confirmed top-ups stack correctly."""
    admin = wallet_setup["admin"]
    wallet = wallet_setup["wallet"]
    i1 = _make_intent(db_session_pos, wallet.id, 300.00, "cash")
    i2 = _make_intent(db_session_pos, wallet.id, 200.00, "qr_promptpay")

    WalletService.confirm_topup(db_session_pos, i1.ref_code, admin.id)
    WalletService.confirm_topup(db_session_pos, i2.ref_code, admin.id)

    db_session_pos.refresh(wallet)
    assert float(wallet.balance) == 500.00
