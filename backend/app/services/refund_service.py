"""
Graduation Refund Service — list candidates with positive wallet balance and
issue a payout (CASH / BANK_TRANSFER / CHEQUE) that debits the wallet inside a
single transaction.

Note: `is_graduated` is NOT enforced here — cashier verifies visually. We only
require `customer.is_active` and `wallet.is_active` with `balance > 0`.
"""
from __future__ import annotations

from decimal import Decimal
from typing import List, Optional

from sqlalchemy import asc, desc, nulls_last
from sqlalchemy.orm import Session, joinedload

from app.models.customer import Customer
from app.models.wallet import Wallet, WalletTransaction, WalletTransactionType
from app.schemas.refund import RefundCandidate, RefundResponse


_VALID_METHODS = {"CASH", "BANK_TRANSFER", "CHEQUE"}
_METHOD_LABEL = {
    "CASH": "Cash",
    "BANK_TRANSFER": "Bank transfer",
    "CHEQUE": "Cheque",
}


class RefundService:

    # ── Candidate listing ─────────────────────────────────────────────────────

    @staticmethod
    def list_candidates(db: Session) -> List[RefundCandidate]:
        """Return all customers with wallet balance > 0.

        Filter: wallet.balance > 0 AND wallet.is_active AND customer.is_active.
        Sort: is_graduated DESC, withdraw_date DESC NULLS LAST, name ASC.
        """
        rows = (
            db.query(Customer, Wallet)
            .join(Wallet, Wallet.customer_id == Customer.id)
            .filter(
                Wallet.balance > 0,
                Wallet.is_active.is_(True),
                Customer.is_active.is_(True),
            )
            .order_by(
                desc(Customer.is_graduated),
                nulls_last(desc(Customer.withdraw_date)),
                asc(Customer.name),
            )
            .all()
        )
        return [
            RefundCandidate(
                id=customer.id,
                name=customer.name,
                student_code=customer.student_code,
                family_code=customer.family_code,
                is_graduated=customer.is_graduated,
                wallet_id=wallet.id,
                wallet_balance=Decimal(str(wallet.balance)),
                enroll_date=customer.enroll_date,
                withdraw_date=customer.withdraw_date,
            )
            for customer, wallet in rows
        ]

    # ── Refund issuance ───────────────────────────────────────────────────────

    @staticmethod
    def create_refund(
        db: Session,
        customer_id: int,
        amount: Decimal,
        method: str,
        notes: Optional[str],
        user_id: int,
    ) -> RefundResponse:
        """Issue a graduation refund (wallet debit) under one DB transaction.

        Stores `amount` as a positive Decimal — direction is encoded in
        `balance_before` / `balance_after`, matching the convention used by
        `WalletService.adjust_balance` and `ReturnsService` REFUND rows.
        """
        # ── Validation (pre-transaction) ──────────────────────────────────
        if amount is None or Decimal(str(amount)) <= 0:
            raise ValueError("Refund amount must be positive")
        if method not in _VALID_METHODS:
            raise ValueError(
                f"Invalid refund method '{method}'. Must be one of: "
                f"{sorted(_VALID_METHODS)}"
            )
        amount_dec = Decimal(str(amount))

        try:
            # Lock the wallet row to prevent concurrent balance mutation.
            wallet = (
                db.query(Wallet)
                .with_for_update()
                .filter(Wallet.customer_id == customer_id)
                .first()
            )
            if not wallet:
                raise ValueError(f"Wallet not found for customer {customer_id}")
            if not wallet.is_active:
                raise ValueError(f"Wallet {wallet.id} is inactive")

            balance_before = Decimal(str(wallet.balance))
            if amount_dec > balance_before:
                raise ValueError(
                    f"Refund amount ฿{amount_dec:.2f} exceeds wallet balance "
                    f"฿{balance_before:.2f}"
                )

            wallet.balance = balance_before - amount_dec

            note_part = f" — {notes.strip()}" if notes and notes.strip() else ""
            description = (
                f"Graduation refund ({_METHOD_LABEL[method]}){note_part}"
            )

            tx = WalletTransaction(
                wallet_id=wallet.id,
                transaction_type=WalletTransactionType.REFUND,
                amount=amount_dec,
                balance_before=balance_before,
                balance_after=wallet.balance,
                reference_type="graduation_refund",
                reference_id=None,
                description=description,
                reason="graduation_refund",
                refund_method=method,
                reference_ticket=None,
                created_by=user_id,
            )
            db.add(tx)
            db.commit()
            db.refresh(tx)

            return RefundResponse(
                transaction_id=tx.id,
                customer_id=customer_id,
                wallet_id=wallet.id,
                amount=amount_dec,
                refund_method=method,
                balance_before=balance_before,
                balance_after=Decimal(str(wallet.balance)),
                reason="graduation_refund",
                notes=notes,
                created_at=tx.created_at,
                created_by_user_id=user_id,
            )
        except Exception:
            db.rollback()
            raise
