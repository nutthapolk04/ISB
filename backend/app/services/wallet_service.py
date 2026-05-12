"""
Wallet Service — balance operations, top-up flow, authorization helpers.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional
from decimal import Decimal

from sqlalchemy.orm import Session, joinedload
from sqlalchemy import desc, func as sqlfunc

from app.models.wallet import Wallet, WalletTransaction, WalletTransactionType
from app.models.customer import Customer
from app.models.parent_child_link import ParentChildLink
from app.models.payment_intent import PaymentIntent, PaymentIntentStatus
from app.models.user import User
from app.core.errors import BusinessRuleError


def _generate_ref_code(db: Session) -> str:
    """Generate unique ref code: TOP-YYYYMMDD-NNN"""
    today_str = date.today().strftime("%Y%m%d")
    prefix = f"TOP-{today_str}-"
    last = (
        db.query(PaymentIntent)
        .filter(PaymentIntent.ref_code.like(f"{prefix}%"))
        .order_by(desc(PaymentIntent.id))
        .first()
    )
    seq = 1
    if last:
        try:
            seq = int(last.ref_code.split("-")[-1]) + 1
        except ValueError:
            seq = 1
    return f"{prefix}{seq:03d}"


def _build_mock_qr_payload(ref_code: str, amount: float) -> str:
    """Generate a placeholder QR payload string (not a real EMVCo QR)."""
    # Demo format: "promptpay://isb-schooney/{ref_code}/{amount}"
    return f"promptpay://isb-schooney/{ref_code}/{amount:.2f}"


_TOPUP_LABEL_BY_METHOD = {
    "qr_promptpay": "Top-up via PromptPay",
    "credit_card": "Top-up via Credit/Debit Card",
    "cash": "Top-up via Cash",
}


def _ensure_wallet_for_customer(db: Session, customer_id: int) -> Wallet:
    """Get or create a wallet for a customer."""
    wallet = db.query(Wallet).filter(Wallet.customer_id == customer_id).first()
    if not wallet:
        wallet = Wallet(customer_id=customer_id, balance=0, is_active=True)
        db.add(wallet)
        db.flush()
    return wallet


def _ensure_wallet_for_user(db: Session, user_id: int) -> Wallet:
    """Get or create a personal wallet for a user (parent/staff)."""
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    if not wallet:
        wallet = Wallet(user_id=user_id, balance=0, is_active=True)
        db.add(wallet)
        db.flush()
    return wallet


def _ensure_wallet_for_department(db: Session, department_id: int) -> Wallet:
    """Get or create a wallet for a department (negative-allowed credit line)."""
    wallet = db.query(Wallet).filter(Wallet.department_id == department_id).first()
    if not wallet:
        wallet = Wallet(department_id=department_id, balance=0, is_active=True)
        db.add(wallet)
        db.flush()
    return wallet


def _enrich_wallet(wallet: Wallet) -> dict:
    """Build a response dict with nested owner info (customer | user | department)."""
    base = {
        "id": wallet.id,
        "balance": float(wallet.balance),
        "is_active": wallet.is_active,
        # Default the polymorphic id fields to None; only the matching one is set.
        "customer_id": None,
        "user_id": None,
        "department_id": None,
        "name": None,
        "photo_url": None,
        "customer_code": None,
        "student_code": None,
        "grade": None,
        "card_frozen": None,
        "daily_limit": None,
        "username": None,
        "role": None,
        "department_code": None,
    }
    if wallet.user_id is not None:
        u = wallet.user
        base.update({
            "owner_type": "user",
            "user_id": wallet.user_id,
            "name": u.full_name if u else None,
            "photo_url": u.photo_url if u else None,
            "username": u.username if u else None,
            "role": u.role if u else None,
        })
        return base
    if wallet.department_id is not None:
        d = wallet.department
        base.update({
            "owner_type": "department",
            "department_id": wallet.department_id,
            "name": d.department_name if d else None,
            "department_code": d.department_code if d else None,
        })
        return base
    c = wallet.customer
    base.update({
        "owner_type": "customer",
        "customer_id": wallet.customer_id,
        "name": c.name if c else None,
        "photo_url": c.photo_url if c else None,
        "customer_code": c.customer_code if c else None,
        "student_code": c.student_code if c else None,
        "grade": c.grade if c else None,
        "card_frozen": c.card_frozen if c else None,
        "daily_limit": float(c.daily_limit) if c and c.daily_limit is not None else None,
    })
    return base


class WalletService:

    # ── Authorization ─────────────────────────────────────────────────────────

    @staticmethod
    def user_can_access_wallet(db: Session, user: User, wallet: Wallet) -> bool:
        """Admin always; own wallet always; any user with linked-child access.

        Department wallets are admin-only. Customer (student) wallets are
        accessible to any user who has a `parent_child_links` row pointing at
        the wallet's customer — regardless of role label, since PowerSchool
        seeds staff-with-children as role=staff and we don't want them locked
        out of their own kids' wallets.
        """
        if user.is_superuser or user.role == "admin":
            return True
        if wallet.department_id is not None:
            return False
        if wallet.user_id is not None and wallet.user_id == user.id:
            return True
        if wallet.customer_id is not None:
            # Students can only access their own wallet — match by username.
            if user.role == "student":
                customer = (
                    db.query(Customer)
                    .filter(Customer.student_code == user.username)
                    .first()
                )
                return customer is not None and wallet.customer_id == customer.id
            link = (
                db.query(ParentChildLink)
                .filter(
                    ParentChildLink.parent_user_id == user.id,
                    ParentChildLink.child_customer_id == wallet.customer_id,
                )
                .first()
            )
            return link is not None
        return False

    # ── Lookup ────────────────────────────────────────────────────────────────

    @staticmethod
    def get_wallet(db: Session, wallet_id: int) -> Optional[Wallet]:
        return (
            db.query(Wallet)
            .options(
                joinedload(Wallet.customer),
                joinedload(Wallet.user),
                joinedload(Wallet.department),
            )
            .filter(Wallet.id == wallet_id)
            .first()
        )

    @staticmethod
    def list_family_wallets(db: Session, user: User) -> List[Wallet]:
        """Return wallets the user can see.

        Student → their own Customer-keyed wallet only (matched by username).
        Otherwise → parent's own User-keyed wallet first, then linked children.
        """
        if user.role == "student":
            customer = (
                db.query(Customer)
                .filter(Customer.student_code == user.username)
                .first()
            )
            if not customer:
                return []
            wallet = _ensure_wallet_for_customer(db, customer.id)
            db.commit()
            db.refresh(wallet)
            full = (
                db.query(Wallet)
                .options(joinedload(Wallet.customer))
                .filter(Wallet.id == wallet.id)
                .first()
            )
            return [full] if full else []

        # Parent's own wallet (auto-created if missing).
        own = _ensure_wallet_for_user(db, user.id)
        links = (
            db.query(ParentChildLink)
            .filter(ParentChildLink.parent_user_id == user.id)
            .all()
        )
        child_ids = [l.child_customer_id for l in links]
        for cid in child_ids:
            _ensure_wallet_for_customer(db, cid)
        db.commit()
        db.refresh(own)
        # Reload with eager owner data so enrich_wallet doesn't re-query.
        own_full = (
            db.query(Wallet)
            .options(joinedload(Wallet.user))
            .filter(Wallet.id == own.id)
            .first()
        )
        children = (
            db.query(Wallet)
            .options(joinedload(Wallet.customer))
            .filter(Wallet.customer_id.in_(child_ids))
            .all()
            if child_ids
            else []
        )
        return [own_full] + children if own_full else children

    # ── Transactions ──────────────────────────────────────────────────────────

    @staticmethod
    def list_transactions(
        db: Session,
        wallet_id: int,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        limit: int = 500,
    ) -> List[WalletTransaction]:
        q = (
            db.query(WalletTransaction)
            .filter(WalletTransaction.wallet_id == wallet_id)
            .order_by(desc(WalletTransaction.created_at))
        )
        if date_from:
            q = q.filter(sqlfunc.date(WalletTransaction.created_at) >= date_from)
        if date_to:
            q = q.filter(sqlfunc.date(WalletTransaction.created_at) <= date_to)
        return q.limit(limit).all()

    # ── Top-up flow ───────────────────────────────────────────────────────────

    @staticmethod
    def create_topup_intent(
        db: Session,
        wallet_id: int,
        amount: float,
        user_id: int,
        notes: Optional[str] = None,
        payment_method: str = "qr_promptpay",
    ) -> PaymentIntent:
        wallet = db.query(Wallet).filter(Wallet.id == wallet_id).first()
        if not wallet:
            raise ValueError(f"Wallet {wallet_id} not found")
        if amount <= 0:
            raise ValueError("Top-up amount must be positive")

        ref = _generate_ref_code(db)
        intent = PaymentIntent(
            ref_code=ref,
            wallet_id=wallet_id,
            amount=amount,
            qr_payload=_build_mock_qr_payload(ref, amount),
            status=PaymentIntentStatus.pending,
            payment_method=payment_method,
            created_by=user_id,
            notes=notes,
        )
        db.add(intent)
        db.commit()
        db.refresh(intent)
        return intent

    @staticmethod
    def confirm_topup(
        db: Session,
        ref_code: str,
        confirmer_user_id: int,
        notes: Optional[str] = None,
        confirmed_via: Optional[str] = None,
    ) -> WalletTransaction:
        intent = (
            db.query(PaymentIntent)
            .filter(PaymentIntent.ref_code == ref_code)
            .first()
        )
        if not intent:
            raise ValueError(f"Payment intent {ref_code} not found")
        if intent.status != PaymentIntentStatus.pending:
            raise ValueError(f"Intent already {intent.status.value}")

        wallet = db.query(Wallet).filter(Wallet.id == intent.wallet_id).first()
        if not wallet:
            raise ValueError("Wallet not found")

        balance_before = Decimal(str(wallet.balance))
        amount = Decimal(str(intent.amount))
        wallet.balance = balance_before + amount

        tx = WalletTransaction(
            wallet_id=wallet.id,
            transaction_type=WalletTransactionType.TOPUP,
            amount=amount,
            balance_before=balance_before,
            balance_after=wallet.balance,
            reference_type="payment_intent",
            reference_id=intent.id,
            description=f"{_TOPUP_LABEL_BY_METHOD.get(intent.payment_method, 'Top-up')} ({ref_code})",
            created_by=confirmer_user_id,
        )
        db.add(tx)

        intent.status = PaymentIntentStatus.confirmed
        intent.confirmed_at = datetime.utcnow()
        intent.confirmed_by = confirmer_user_id
        intent.confirmed_via = confirmed_via
        if notes:
            intent.notes = (intent.notes or "") + f"\n{notes}"

        db.commit()
        db.refresh(tx)
        return tx

    # ── Manual balance adjustment (admin, audit-logged) ──────────────────────

    @staticmethod
    def adjust_balance(
        db: Session,
        wallet_id: int,
        amount: float,
        admin_user_id: int,
        reason: str,
        reference_ticket: Optional[str] = None,
    ) -> WalletTransaction:
        """
        Admin-only manual adjustment. Positive amount = credit, negative = debit.
        Creates an ADJUSTMENT transaction with reason + optional ref_ticket for audit.
        """
        if amount == 0:
            raise ValueError("Adjustment amount must be non-zero")
        if not reason or not reason.strip():
            raise ValueError("Reason is required for balance adjustment")

        wallet = db.query(Wallet).filter(Wallet.id == wallet_id).first()
        if not wallet:
            raise ValueError(f"Wallet {wallet_id} not found")

        balance_before = Decimal(str(wallet.balance))
        amount_dec = Decimal(str(amount))
        wallet.balance = balance_before + amount_dec

        direction = "credit" if amount_dec > 0 else "debit"
        ref_tag = f" [ref:{reference_ticket}]" if reference_ticket else ""
        description = f"Admin {direction} adjustment{ref_tag} — {reason.strip()}"

        tx = WalletTransaction(
            wallet_id=wallet.id,
            transaction_type=WalletTransactionType.ADJUSTMENT,
            amount=abs(amount_dec),  # store absolute; direction encoded in balance_before/after
            balance_before=balance_before,
            balance_after=wallet.balance,
            reference_type="admin_adjustment",
            reference_id=None,
            description=description,
            created_by=admin_user_id,
        )
        db.add(tx)
        db.commit()
        db.refresh(tx)
        return tx

    # ── Family transfer (any direction inside one family) ────────────────────

    @staticmethod
    def transfer_within_family(
        db: Session,
        from_wallet_id: int,
        to_wallet_id: int,
        amount: float,
        initiator_user_id: int,
        initiator_is_admin: bool,
        note: Optional[str] = None,
    ) -> tuple[WalletTransaction, WalletTransaction]:
        """Move funds between two wallets reachable by the same parent.

        Supports every direction within one family:
        - parent's own wallet ↔ child's wallet
        - child ↔ child (legacy sibling transfer)
        - child ↔ parent's own wallet
        Auth: admin caller bypasses the family check; otherwise the initiator
        must be the authenticated parent and BOTH wallets must be reachable by
        that parent (own wallet, or child wallet linked via ParentChildLink).
        """
        if amount <= 0:
            raise ValueError("Transfer amount must be positive")
        if from_wallet_id == to_wallet_id:
            raise ValueError("Cannot transfer to the same wallet")

        from_wallet = db.query(Wallet).filter(Wallet.id == from_wallet_id).first()
        to_wallet = db.query(Wallet).filter(Wallet.id == to_wallet_id).first()
        if not from_wallet:
            raise ValueError(f"Source wallet {from_wallet_id} not found")
        if not to_wallet:
            raise ValueError(f"Destination wallet {to_wallet_id} not found")

        if not initiator_is_admin:
            # Resolve the set of users that can act on each wallet:
            # - user-keyed wallet: only its owner
            # - customer-keyed wallet: every parent linked to that customer
            def reachable_by(w: Wallet) -> set[int]:
                if w.user_id is not None:
                    return {w.user_id}
                return {
                    l.parent_user_id for l in
                    db.query(ParentChildLink)
                    .filter(ParentChildLink.child_customer_id == w.customer_id)
                    .all()
                }

            common = reachable_by(from_wallet) & reachable_by(to_wallet)
            if initiator_user_id not in common:
                raise ValueError("Wallets are not in the same family for this user")

        debit_before = Decimal(str(from_wallet.balance))
        credit_before = Decimal(str(to_wallet.balance))
        amount_dec = Decimal(str(amount))
        projected_from = debit_before - amount_dec

        # Negative-balance policy on the source wallet:
        # - department wallet → unrestricted (always allowed)
        # - user wallet       → gated by `allow_negative_user_wallet` flag
        # - customer wallet   → gated by `allow_negative_customer_wallet` flag,
        #                       falling back to per-customer `negative_credit_limit`
        # Admins do not bypass this — they have admin-adjust endpoints for that.
        if from_wallet.department_id is None:
            from app.services.settings_service import SettingsService  # local import avoids cycles
            if from_wallet.user_id is not None:
                allow_neg = SettingsService.get_bool(db, "allow_negative_user_wallet", default=False)
                if not allow_neg and projected_from < 0:
                    raise BusinessRuleError(
                        code="INSUFFICIENT_USER_WALLET_TRANSFER",
                        params={
                            "balance": float(debit_before),
                            "amount": float(amount_dec),
                        },
                        message=(
                            f"ยอดเงินใน wallet ผู้โอนไม่พอ. คงเหลือ ฿{float(debit_before):.2f}, "
                            f"จะโอน ฿{float(amount_dec):.2f}"
                        ),
                    )
            elif from_wallet.customer_id is not None:
                allow_neg_global = SettingsService.get_bool(
                    db, "allow_negative_customer_wallet", default=False,
                )
                if not allow_neg_global:
                    customer = (
                        db.query(Customer)
                        .filter(Customer.id == from_wallet.customer_id)
                        .first()
                    )
                    max_overdraft = (
                        Decimal(str(customer.negative_credit_limit))
                        if customer and customer.negative_credit_limit is not None
                        else Decimal("0")
                    )
                    if projected_from < -max_overdraft:
                        raise BusinessRuleError(
                            code="EXCEEDS_NEGATIVE_CREDIT_LIMIT_TRANSFER",
                            params={
                                "balance": float(debit_before),
                                "amount": float(amount_dec),
                                "maxOverdraft": float(max_overdraft),
                            },
                            message=(
                                f"ยอด wallet จะติดลบเกินขีดจำกัด. คงเหลือ ฿{float(debit_before):.2f}, "
                                f"จะโอน ฿{float(amount_dec):.2f}, overdraft ที่อนุญาต ฿{float(max_overdraft):.2f}"
                            ),
                        )

        from_wallet.balance = projected_from
        to_wallet.balance = credit_before + amount_dec

        note_part = f" — {note.strip()}" if note and note.strip() else ""
        desc_debit = f"Family transfer → wallet#{to_wallet.id}{note_part}"
        desc_credit = f"Family transfer ← wallet#{from_wallet.id}{note_part}"

        debit_tx = WalletTransaction(
            wallet_id=from_wallet.id,
            transaction_type=WalletTransactionType.ADJUSTMENT,
            amount=amount_dec,
            balance_before=debit_before,
            balance_after=from_wallet.balance,
            reference_type="family_transfer",
            reference_id=to_wallet.id,
            description=desc_debit,
            created_by=initiator_user_id,
        )
        credit_tx = WalletTransaction(
            wallet_id=to_wallet.id,
            transaction_type=WalletTransactionType.ADJUSTMENT,
            amount=amount_dec,
            balance_before=credit_before,
            balance_after=to_wallet.balance,
            reference_type="family_transfer",
            reference_id=from_wallet.id,
            description=desc_credit,
            created_by=initiator_user_id,
        )
        db.add(debit_tx)
        db.add(credit_tx)
        db.commit()
        db.refresh(debit_tx)
        db.refresh(credit_tx)
        return debit_tx, credit_tx

    @staticmethod
    def transfer_between_siblings(
        db: Session,
        from_wallet_id: int,
        to_wallet_id: int,
        amount: float,
        initiator_user_id: int,
        initiator_is_admin: bool,
        note: Optional[str] = None,
    ) -> tuple[WalletTransaction, WalletTransaction]:
        """Backward-compat wrapper — delegates to ``transfer_within_family``."""
        return WalletService.transfer_within_family(
            db,
            from_wallet_id=from_wallet_id,
            to_wallet_id=to_wallet_id,
            amount=amount,
            initiator_user_id=initiator_user_id,
            initiator_is_admin=initiator_is_admin,
            note=note,
        )

    # ── Daily limit check ─────────────────────────────────────────────────────

    @staticmethod
    def today_deducted(db: Session, wallet_id: int) -> float:
        """Sum of DEDUCTION transactions for wallet on today's date."""
        today = date.today()
        total = (
            db.query(sqlfunc.coalesce(sqlfunc.sum(WalletTransaction.amount), 0))
            .filter(
                WalletTransaction.wallet_id == wallet_id,
                WalletTransaction.transaction_type == WalletTransactionType.DEDUCTION,
                sqlfunc.date(WalletTransaction.created_at) == today,
            )
            .scalar()
        )
        return float(total or 0)

    # ── Helpers for external use ─────────────────────────────────────────────

    @staticmethod
    def enrich_wallet(wallet: Wallet) -> dict:
        return _enrich_wallet(wallet)

    @staticmethod
    def ensure_wallet_for_customer(db: Session, customer_id: int) -> Wallet:
        return _ensure_wallet_for_customer(db, customer_id)

    @staticmethod
    def ensure_wallet_for_user(db: Session, user_id: int) -> Wallet:
        return _ensure_wallet_for_user(db, user_id)

    @staticmethod
    def ensure_wallet_for_department(db: Session, department_id: int) -> Wallet:
        return _ensure_wallet_for_department(db, department_id)
