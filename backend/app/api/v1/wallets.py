"""
Wallet API Routes — parent/student balance + top-up + admin confirmation.
"""
import logging
from datetime import date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user, require_role
from app.models.user import User
from app.models.wallet import Wallet
from app.schemas.wallet import (
    WalletResponse, WalletTransactionResponse,
    TopupRequest, TopupIntentResponse,
    AdjustBalanceRequest,
    SiblingTransferRequest, SiblingTransferResponse,
    CashierTopupRequest, CashierTopupResponse,
)
from app.services.wallet_service import WalletService
from app.services.audit_service import create_audit_log
from app.models.receipt import Receipt
from app.models.shop import Shop

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Family / self wallets ────────────────────────────────────────────────────

WALLET_USER_ROLES = ("parent", "staff", "cashier", "manager", "kitchen", "admin")


@router.get("/me", response_model=Optional[WalletResponse])
def get_my_wallet(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the caller's personal wallet.

    - Parent/staff/admin: their User-keyed wallet (auto-created on first hit).
    - Student/customer-shaped User: legacy Customer-keyed wallet via username
      matching student_code or customer_code.
    - Anyone else: 200 with `null`.
    """
    if (current_user.role or "").lower() in WALLET_USER_ROLES or current_user.is_superuser:
        w = WalletService.ensure_wallet_for_user(db, current_user.id)
        db.commit()
        db.refresh(w)
        return WalletService.enrich_wallet(w)

    from app.models.customer import Customer
    c = (
        db.query(Customer)
        .filter(
            (Customer.student_code == current_user.username)
            | (Customer.customer_code == current_user.username)
        )
        .first()
    )
    if not c:
        return None
    w = WalletService.ensure_wallet_for_customer(db, c.id)
    db.commit()
    db.refresh(w)
    return WalletService.enrich_wallet(w)


@router.get("/family", response_model=List[WalletResponse])
def get_family_wallets(
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("parent", "staff", "cashier", "manager", "kitchen", "admin", "student")
    ),
):
    """All wallets the user has access to: own + linked children (any role)."""
    wallets = WalletService.list_family_wallets(db, current_user)
    return [WalletService.enrich_wallet(w) for w in wallets]


@router.get("/{wallet_id}", response_model=WalletResponse)
def get_wallet(
    wallet_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    w = WalletService.get_wallet(db, wallet_id)
    if not w:
        raise HTTPException(status_code=404, detail="Wallet not found")
    if not WalletService.user_can_access_wallet(db, current_user, w):
        raise HTTPException(status_code=403, detail="Not authorized to view this wallet")
    return WalletService.enrich_wallet(w)


@router.get("/{wallet_id}/transactions", response_model=List[WalletTransactionResponse])
def list_wallet_transactions(
    wallet_id: int,
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    w = WalletService.get_wallet(db, wallet_id)
    if not w:
        raise HTTPException(status_code=404, detail="Wallet not found")
    if not WalletService.user_can_access_wallet(db, current_user, w):
        raise HTTPException(status_code=403, detail="Not authorized")
    txs = WalletService.list_transactions(db, wallet_id, date_from, date_to)

    # Enrich with shop_name by resolving receipt → shop for referenced transactions
    receipt_ids = [tx.reference_id for tx in txs if tx.reference_type in ("receipt", "receipt_void") and tx.reference_id]
    shop_by_receipt: dict[int, tuple[Optional[str], Optional[str]]] = {}
    if receipt_ids:
        rows = (
            db.query(Receipt.id, Receipt.shop_id, Shop.name)
            .outerjoin(Shop, Shop.id == Receipt.shop_id)
            .filter(Receipt.id.in_(receipt_ids))
            .all()
        )
        shop_by_receipt = {r[0]: (r[1], r[2]) for r in rows}

    def _enrich(tx):
        shop_id, shop_name = None, None
        if tx.reference_type in ("receipt", "receipt_void") and tx.reference_id:
            shop_id, shop_name = shop_by_receipt.get(tx.reference_id, (None, None))
        return WalletTransactionResponse(
            id=tx.id,
            wallet_id=tx.wallet_id,
            transaction_type=tx.transaction_type.value,
            amount=float(tx.amount),
            balance_before=float(tx.balance_before),
            balance_after=float(tx.balance_after),
            reference_type=tx.reference_type,
            reference_id=tx.reference_id,
            description=tx.description,
            shop_id=shop_id,
            shop_name=shop_name,
            created_at=tx.created_at,
        )

    return [_enrich(tx) for tx in txs]


# ── Top-up ───────────────────────────────────────────────────────────────────

@router.post("/{wallet_id}/topup", response_model=TopupIntentResponse)
def create_topup(
    wallet_id: int,
    payload: TopupRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("parent", "staff", "admin", "cashier", "manager", "kitchen", "student")
    ),
):
    """Create a pending top-up intent. Authorised for any wallet the caller can access."""
    w = WalletService.get_wallet(db, wallet_id)
    if not w:
        raise HTTPException(status_code=404, detail="Wallet not found")
    if not WalletService.user_can_access_wallet(db, current_user, w):
        raise HTTPException(status_code=403, detail="Not authorized")
    try:
        intent = WalletService.create_topup_intent(
            db, wallet_id, payload.amount, current_user.id,
            payload.notes, payload.payment_method,
        )
        return TopupIntentResponse(
            ref_code=intent.ref_code,
            wallet_id=intent.wallet_id,
            amount=float(intent.amount),
            qr_payload=intent.qr_payload or "",
            status=intent.status.value,
            payment_method=intent.payment_method,
            confirmed_via=intent.confirmed_via,
            created_at=intent.created_at,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/topup/{ref_code}/parent-confirm", response_model=WalletTransactionResponse)
def parent_confirm_topup(
    ref_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("parent", "staff", "cashier", "manager", "kitchen", "student")
    ),
):
    """Self-confirm a pending top-up — credits wallet immediately for any wallet
    the caller can access (own wallet for staff, child wallet for parents,
    self for students)."""
    from app.models.payment_intent import PaymentIntent
    intent = db.query(PaymentIntent).filter(PaymentIntent.ref_code == ref_code).first()
    if not intent:
        raise HTTPException(status_code=404, detail="Top-up intent not found")
    w = WalletService.get_wallet(db, intent.wallet_id)
    if not w or not WalletService.user_can_access_wallet(db, current_user, w):
        raise HTTPException(status_code=403, detail="Not authorized")
    try:
        tx = WalletService.confirm_topup(
            db, ref_code, current_user.id, confirmed_via="parent_self",
        )
        return WalletTransactionResponse(
            id=tx.id,
            wallet_id=tx.wallet_id,
            transaction_type=tx.transaction_type.value,
            amount=float(tx.amount),
            balance_before=float(tx.balance_before),
            balance_after=float(tx.balance_after),
            reference_type=tx.reference_type,
            reference_id=tx.reference_id,
            description=tx.description,
            created_at=tx.created_at,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Cashier/Manager: cash top-up at POS ─────────────────────────────────────

@router.post("/{wallet_id}/cashier-topup", response_model=CashierTopupResponse)
def cashier_topup(
    wallet_id: int,
    payload: CashierTopupRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("cashier", "manager", "admin", "staff")),
):
    """Cashier or manager top-ups a customer wallet with cash at POS.

    This is a direct top-up that doesn't require the QR payment flow.
    The cashier receives cash from the customer and immediately credits their wallet.
    """
    from app.models.customer import Customer

    w = WalletService.get_wallet(db, wallet_id)
    if not w:
        raise HTTPException(status_code=404, detail="Wallet not found")

    # Get customer name for response
    customer_name = "Unknown"
    if w.customer_id:
        customer = db.query(Customer).filter(Customer.id == w.customer_id).first()
        if customer:
            customer_name = customer.name or f"Customer #{customer.id}"
    elif w.user_id:
        user = db.query(User).filter(User.id == w.user_id).first()
        if user:
            customer_name = user.full_name or user.username

    try:
        tx = WalletService.adjust_balance(
            db,
            wallet_id=wallet_id,
            amount=payload.amount,
            admin_user_id=current_user.id,
            reason=f"Cash top-up at POS" + (f" - {payload.notes}" if payload.notes else ""),
            reference_ticket=None,
        )
        return CashierTopupResponse(
            wallet_id=wallet_id,
            customer_name=customer_name,
            amount=payload.amount,
            balance_before=float(tx.balance_before),
            balance_after=float(tx.balance_after),
            transaction_id=tx.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Family transfer (parent moves money between own + children's wallets) ──

def _tx_to_response(tx) -> WalletTransactionResponse:
    return WalletTransactionResponse(
        id=tx.id,
        wallet_id=tx.wallet_id,
        transaction_type=tx.transaction_type.value,
        amount=float(tx.amount),
        balance_before=float(tx.balance_before),
        balance_after=float(tx.balance_after),
        reference_type=tx.reference_type,
        reference_id=tx.reference_id,
        description=tx.description,
        created_at=tx.created_at,
    )


@router.post("/transfer", response_model=SiblingTransferResponse)
def transfer_within_family(
    payload: SiblingTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("staff", "cashier", "manager", "kitchen", "admin")
    ),
):
    """Move funds between any two wallets. Parent-initiated transfers are disabled
    (anti-money-laundering policy); only staff/admin may perform wallet transfers.
    """
    is_admin = current_user.is_superuser or current_user.role == "admin"
    try:
        debit_tx, credit_tx = WalletService.transfer_within_family(
            db,
            from_wallet_id=payload.from_wallet_id,
            to_wallet_id=payload.to_wallet_id,
            amount=payload.amount,
            initiator_user_id=current_user.id,
            initiator_is_admin=is_admin,
            note=payload.note,
        )
        return SiblingTransferResponse(
            debit_tx=_tx_to_response(debit_tx),
            credit_tx=_tx_to_response(credit_tx),
            from_balance_after=float(debit_tx.balance_after),
            to_balance_after=float(credit_tx.balance_after),
        )
    except ValueError as e:
        msg = str(e)
        if "not in the same family" in msg or "not linked" in msg:
            raise HTTPException(status_code=403, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


# ── Admin: manual balance adjustment (audit-logged) ─────────────────────────

@router.post("/{wallet_id}/adjust", response_model=WalletTransactionResponse)
def adjust_wallet_balance(
    wallet_id: int,
    payload: AdjustBalanceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Admin credits or debits a wallet manually with reason + optional reference ticket."""
    w = WalletService.get_wallet(db, wallet_id)
    if not w:
        raise HTTPException(status_code=404, detail="Wallet not found")
    try:
        tx = WalletService.adjust_balance(
            db,
            wallet_id=wallet_id,
            amount=payload.amount,
            admin_user_id=current_user.id,
            reason=payload.reason,
            reference_ticket=payload.reference_ticket,
        )
        try:
            create_audit_log(
                db,
                entity_type="wallet",
                entity_id=wallet_id,
                entity_name=f"wallet#{wallet_id}",
                shop_id=None,
                action="UPDATE_BALANCE",
                changes={
                    "reason": payload.reason,
                    "amount": payload.amount,
                    "balance_before": float(tx.balance_before),
                    "balance_after": float(tx.balance_after),
                },
                user_id=current_user.id,
            )
            db.commit()
        except Exception:
            db.rollback()
        return WalletTransactionResponse(
            id=tx.id,
            wallet_id=tx.wallet_id,
            transaction_type=tx.transaction_type.value,
            amount=float(tx.amount),
            balance_before=float(tx.balance_before),
            balance_after=float(tx.balance_after),
            reference_type=tx.reference_type,
            reference_id=tx.reference_id,
            description=tx.description,
            created_at=tx.created_at,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
