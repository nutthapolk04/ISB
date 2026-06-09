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
            txn_no=intent.txn_no,
            payment_page_url=getattr(intent, '_payment_page_url', None),
            payment_form_params=getattr(intent, '_payment_form_params', None),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/topup/{ref_code}/status")
def get_topup_status(
    ref_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("parent", "staff", "admin", "cashier", "manager", "kitchen", "student")
    ),
):
    """Read-only intent status for the success-page poller."""
    from app.models.payment_intent import PaymentIntent
    intent = db.query(PaymentIntent).filter(PaymentIntent.ref_code == ref_code).first()
    if not intent:
        raise HTTPException(status_code=404, detail="Top-up intent not found")
    w = WalletService.get_wallet(db, intent.wallet_id)
    if not w or not WalletService.user_can_access_wallet(db, current_user, w):
        raise HTTPException(status_code=403, detail="Not authorized")
    return {
        "ref_code": intent.ref_code,
        "status": intent.status.value,
        "amount": float(intent.amount),
        "payment_method": intent.payment_method,
    }


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
    current_user: User = Depends(require_role("cashier", "manager", "admin", "staff", "kiosk")),
):
    """Cashier or manager top-ups a customer wallet with cash at POS.

    This is a direct top-up that doesn't require the QR payment flow.
    The cashier receives cash from the customer and immediately credits their wallet.
    """
    from app.models.customer import Customer

    w = WalletService.get_wallet(db, wallet_id)
    if not w:
        raise HTTPException(status_code=404, detail="Wallet not found")

    # Enforce balance cap for non-department wallets (same limit as QR top-up flow)
    MAX_WALLET_BALANCE = 50_000
    if payload.amount > 0 and w.department_id is None:
        projected = float(w.balance or 0) + payload.amount
        if projected > MAX_WALLET_BALANCE:
            available = max(0, MAX_WALLET_BALANCE - float(w.balance or 0))
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Wallet balance cannot exceed ฿{MAX_WALLET_BALANCE:,.0f}. "
                    f"Current: ฿{float(w.balance or 0):,.2f}. "
                    f"Max top-up: ฿{available:,.2f}."
                ),
            )

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


# ── Admin: adjustment report ─────────────────────────────────────────────────

from datetime import datetime as _dt, timedelta as _td
from pydantic import BaseModel as _BaseModel
from app.models.wallet import WalletTransaction, WalletTransactionType as _WTT
from app.models.customer import Customer as _Customer
from app.models.department import Department as _Department
import re as _re


class AdjustmentReportRow(_BaseModel):
    id: int
    created_at: _dt
    entity_type: str
    entity_name: str
    entity_code: str
    direction: str
    amount: float
    balance_before: float
    balance_after: float
    reason: Optional[str]
    reference_ticket: Optional[str]
    adjusted_by: str


def _parse_adj_description(desc: Optional[str]) -> tuple:
    """Extract (reason, reference_ticket) from legacy description strings."""
    if not desc:
        return ("", None)
    ticket = None
    ref_match = _re.search(r'\[ref:([^\]]+)\]', desc)
    if ref_match:
        ticket = ref_match.group(1).strip()
    dash_idx = desc.find(" — ")
    if dash_idx == -1:
        dash_idx = desc.find(" - ")
    if dash_idx != -1:
        reason = desc[dash_idx + 3:].strip()
    else:
        reason = desc
    return (reason, ticket)


@router.get("/admin/adjustment-report", response_model=List[AdjustmentReportRow])
def adjustment_report(
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD inclusive"),
    direction: Optional[str] = Query(None, description="credit | debit"),
    type_filter: Optional[str] = Query(
        None,
        alias="type",
        description="student | staff | department | other — filter rows by wallet owner type",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """All manual wallet adjustments for audit/reporting."""
    q = db.query(WalletTransaction).filter(
        WalletTransaction.transaction_type == _WTT.ADJUSTMENT
    )
    if date_from:
        try:
            q = q.filter(WalletTransaction.created_at >= _dt.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            end = _dt.fromisoformat(date_to) + _td(days=1)
            q = q.filter(WalletTransaction.created_at < end)
        except ValueError:
            pass
    txs = q.order_by(WalletTransaction.created_at.desc()).all()

    rows: List[AdjustmentReportRow] = []
    for tx in txs:
        wallet = tx.wallet
        if not wallet:
            continue
        delta = float(tx.balance_after) - float(tx.balance_before)
        tx_dir = "credit" if delta >= 0 else "debit"
        if direction in ("credit", "debit") and tx_dir != direction:
            continue

        entity_type, entity_name, entity_code = "unknown", "—", "—"
        if wallet.customer_id:
            cust = db.query(_Customer).filter(_Customer.id == wallet.customer_id).first()
            if cust:
                entity_type = "student"
                entity_name = cust.name
                entity_code = cust.student_code or cust.customer_code
        elif wallet.user_id:
            u = db.query(User).filter(User.id == wallet.user_id).first()
            if u:
                entity_type = u.role or "staff"
                entity_name = u.full_name or u.username
                entity_code = u.username
        elif wallet.department_id:
            dept = db.query(_Department).filter(_Department.id == wallet.department_id).first()
            if dept:
                entity_type = "department"
                entity_name = dept.department_name
                entity_code = dept.department_code

        creator = db.query(User).filter(User.id == tx.created_by).first()
        adjusted_by = (creator.full_name or creator.username) if creator else str(tx.created_by)

        reason = tx.reason
        ref_ticket = tx.reference_ticket
        if not reason:
            parsed_reason, parsed_ref = _parse_adj_description(tx.description)
            reason = parsed_reason or None
            if not ref_ticket:
                ref_ticket = parsed_ref

        # Type filter: 'student' / 'department' map directly; 'staff' covers
        # every user-wallet role (cashier, manager, teacher, etc.); 'other' is
        # the unmapped fallback. Compare with the resolved entity_type local
        # — the API caller's choice is `type_filter` (?type= query param).
        if type_filter:
            wanted = type_filter.strip().lower()
            actual_bucket = (
                "student" if entity_type == "student"
                else "department" if entity_type == "department"
                else "other" if entity_type == "unknown"
                else "staff"
            )
            if wanted != actual_bucket:
                continue

        rows.append(AdjustmentReportRow(
            id=tx.id,
            created_at=tx.created_at,
            entity_type=entity_type,
            entity_name=entity_name,
            entity_code=entity_code,
            direction=tx_dir,
            amount=float(tx.amount),
            balance_before=float(tx.balance_before),
            balance_after=float(tx.balance_after),
            reason=reason,
            reference_ticket=ref_ticket,
            adjusted_by=adjusted_by,
        ))
    return rows


# ── Admin: transfer report ────────────────────────────────────────────────────

class TransferReportRow(_BaseModel):
    id: int
    created_at: _dt
    from_name: str
    from_code: str
    to_name: str
    to_code: str
    amount: float
    note: Optional[str]
    transferred_by: str


class TransferReportResponse(_BaseModel):
    items: List[TransferReportRow]
    total: int
    page: int
    pages: int


@router.get("/admin/transfer-report", response_model=TransferReportResponse)
def transfer_report(
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD inclusive"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """All family wallet transfers for audit/reporting (debit side only, no duplicates)."""
    q = db.query(WalletTransaction).filter(
        WalletTransaction.reference_type == "family_transfer",
        WalletTransaction.description.like("Family transfer →%"),
    )
    if date_from:
        try:
            q = q.filter(WalletTransaction.created_at >= _dt.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            end = _dt.fromisoformat(date_to) + _td(days=1)
            q = q.filter(WalletTransaction.created_at < end)
        except ValueError:
            pass

    total = q.count()
    txs = q.order_by(WalletTransaction.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    def _resolve_wallet(w) -> tuple:
        if not w:
            return ("—", "—")
        if w.customer_id:
            c = db.query(_Customer).filter(_Customer.id == w.customer_id).first()
            if c:
                return (c.name, c.student_code or c.customer_code)
        if w.user_id:
            u = db.query(User).filter(User.id == w.user_id).first()
            if u:
                return (u.full_name or u.username, u.username)
        if w.department_id:
            d = db.query(_Department).filter(_Department.id == w.department_id).first()
            if d:
                return (d.department_name, d.department_code)
        return ("—", "—")

    items: List[TransferReportRow] = []
    for tx in txs:
        to_wallet = db.query(Wallet).filter(Wallet.id == tx.reference_id).first() if tx.reference_id else None
        from_name, from_code = _resolve_wallet(tx.wallet)
        to_name, to_code = _resolve_wallet(to_wallet)
        note = None
        if tx.description and " — " in tx.description:
            note = tx.description.split(" — ", 1)[1].strip() or None
        creator = db.query(User).filter(User.id == tx.created_by).first() if tx.created_by else None
        transferred_by = (creator.full_name or creator.username) if creator else "—"
        items.append(TransferReportRow(
            id=tx.id,
            created_at=tx.created_at,
            from_name=from_name,
            from_code=from_code,
            to_name=to_name,
            to_code=to_code,
            amount=float(tx.amount),
            note=note,
            transferred_by=transferred_by,
        ))

    return TransferReportResponse(
        items=items,
        total=total,
        page=page,
        pages=max(1, -(-total // page_size)),
    )
