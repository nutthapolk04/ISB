"""
POS API Routes
POST /api/v1/pos/checkout     — create receipt + deduct stock
GET  /api/v1/pos/receipt      — list receipts (with search)
GET  /api/v1/pos/receipt/{id} — single receipt detail
POST /api/v1/pos/void/{id}    — void a receipt + restore stock
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user, require_role, user_can_access_shop
from app.models.receipt import Receipt
from app.models.shop import ShopProduct
from app.models.user import User
from app.models.wallet import Wallet
from app.schemas.pos import CheckoutPayload, ReceiptResponse, VoidReceiptRequest
from app.services.pos_service import POSService

router = APIRouter()


def _resolve_checkout_shop_id(payload: CheckoutPayload, db: Session) -> Optional[str]:
    """Shop context is either explicit in payload or inferred from the first item."""
    if payload.shop_id:
        return payload.shop_id
    if payload.items:
        first = db.query(ShopProduct).filter(
            ShopProduct.id == payload.items[0].product_variant_id
        ).first()
        if first:
            return first.shop_id
    return None


@router.post("/checkout", response_model=ReceiptResponse)
def checkout(
    payload: CheckoutPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new receipt, deduct stock for each item. Enforces shop scope."""
    shop_id = _resolve_checkout_shop_id(payload, db)
    if shop_id and not user_can_access_shop(current_user, shop_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"User {current_user.username} (shop={getattr(current_user, 'shop_id', None)}) "
                f"is not authorized to checkout at shop '{shop_id}'"
            ),
        )
    try:
        receipt = POSService.checkout(
            db,
            transaction_mode=payload.transaction_mode.value,
            payment_method=payload.payment_method.value,
            items=[item.model_dump() for item in payload.items],
            user_id=current_user.id,
            customer_id=payload.customer_id,
            payer_kind=payload.payer_kind,
            payer_user_id=payload.payer_user_id,
            payer_department_id=payload.payer_department_id,
            requester_user_id=payload.requester_user_id,
            notes=payload.notes,
            shop_id=payload.shop_id,
            bill_discount=payload.discount,
            edc_terminal_ref=payload.edc_terminal_ref,
            edc_approval_code=payload.edc_approval_code,
            edc_masked_card=payload.edc_masked_card,
        )
        return _receipt_to_response(receipt)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/receipt", response_model=List[ReceiptResponse])
def list_receipts(
    q: Optional[str] = Query(None),
    shop_id: Optional[str] = Query(None, description="Filter by single shop"),
    shop_ids: Optional[str] = Query(None, description="Comma-separated shop ids"),
    transaction_mode: Optional[str] = Query(None, description="sale | internal_issue"),
    requester_user_id: Optional[int] = Query(None, description="Filter by requisition staff"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List receipts. Non-admins are auto-scoped to their `users.shop_id`."""
    # Auto-scope: if caller explicitly asks for a shop they can't see → 403.
    # If they don't specify, and they're not admin, clamp to their own shop.
    if shop_id and not user_can_access_shop(current_user, shop_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail=f"Not authorized to view receipts of shop '{shop_id}'")
    effective_shop_id = shop_id
    effective_shop_ids = shop_ids
    caller_shop = getattr(current_user, "shop_id", None)
    if not current_user.is_superuser and caller_shop and not shop_id and not shop_ids:
        effective_shop_id = caller_shop

    receipts = POSService.list_receipts(
        db,
        q=q,
        shop_id=effective_shop_id,
        shop_ids=effective_shop_ids,
        transaction_mode=transaction_mode,
        requester_user_id=requester_user_id,
        page=page,
        page_size=page_size,
    )
    return [_receipt_to_response(r) for r in receipts]


@router.get("/receipt/{receipt_id}", response_model=ReceiptResponse)
def get_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single receipt by ID. Any authenticated user may read receipt details."""
    receipt = POSService.get_receipt(db, receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return _receipt_to_response(receipt, db=db)


@router.post("/void/{receipt_id}", response_model=ReceiptResponse)
def void_receipt(
    receipt_id: int,
    payload: Optional[VoidReceiptRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    """Void a receipt and restore stock. Admin, manager, or cashier."""
    target = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Receipt not found")
    if target.shop_id and not user_can_access_shop(current_user, target.shop_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail=f"Receipt belongs to shop '{target.shop_id}' which is outside your scope")
    try:
        reason = payload.reason if payload else None
        receipt = POSService.void_receipt(db, receipt_id, current_user.id, reason)
        return _receipt_to_response(receipt)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ── Helper ───────────────────────────────────────────────────────────────────

def _receipt_to_response(receipt, db: Optional[Session] = None) -> dict:
    """Convert Receipt ORM to response dict with nested product info."""
    items = []
    for item in receipt.items:
        pv = item.product_variant  # ShopProduct
        items.append({
            "id": item.id,
            "receipt_id": item.receipt_id,
            "product_variant_id": item.product_variant_id,
            "quantity": item.quantity,
            "unit_price": float(item.unit_price),
            "price_override": float(item.price_override) if item.price_override is not None else None,
            "discount": float(item.discount),
            "line_total": float(item.line_total),
            "options": item.options,
            "created_at": item.created_at,
            "product_variant": {
                "sku": pv.product_code if pv else None,
                "variant_name": pv.name if pv else None,
                "barcode": pv.barcode if pv else None,
            } if pv else None,
        })
    if receipt.payer_department_id:
        payer_kind = "department"
    elif receipt.payer_user_id:
        payer_kind = "user"
    elif receipt.customer_id:
        payer_kind = "customer"
    else:
        payer_kind = None
    payer_label: Optional[str] = None
    if receipt.payer_department_id and getattr(receipt, "payer_department", None):
        payer_label = receipt.payer_department.department_name
    elif receipt.payer_user_id and getattr(receipt, "payer_user", None):
        payer_label = receipt.payer_user.full_name
    elif receipt.customer_id and getattr(receipt, "customer", None):
        payer_label = receipt.customer.name

    requester_name: Optional[str] = None
    if getattr(receipt, "requester_user_id", None) and getattr(receipt, "requester", None):
        requester_name = receipt.requester.full_name

    # ── Enrich payer details for wallet-based payments ───────────────────────
    payer_detail: Optional[dict] = None
    if db and payer_kind in ("customer", "user", "department"):
        if payer_kind == "customer" and receipt.customer_id:
            from app.models.customer import Customer as _Customer
            c = db.query(_Customer).filter(_Customer.id == receipt.customer_id).first()
            if c:
                wallet = db.query(Wallet).filter(Wallet.customer_id == c.id).first()
                payer_detail = {
                    "name": c.name,
                    "code": c.student_code or c.customer_code,
                    "grade": getattr(c, "grade", None),
                    "photo_url": getattr(c, "photo_url", None),
                    "role": "student",
                    "wallet_balance": float(wallet.balance) if wallet else None,
                }
        elif payer_kind == "user" and receipt.payer_user_id:
            from app.models.user import User as _User
            u = db.query(_User).filter(_User.id == receipt.payer_user_id).first()
            if u:
                wallet = db.query(Wallet).filter(Wallet.user_id == u.id).first()
                from app.models.department import Department as _Dept
                dept_name = None
                if getattr(u, "department_id", None):
                    d = db.query(_Dept).filter(_Dept.id == u.department_id).first()
                    if d:
                        dept_name = d.department_name
                payer_detail = {
                    "name": u.full_name,
                    "code": u.username,
                    "grade": dept_name,
                    "photo_url": getattr(u, "photo_url", None),
                    "role": u.role or "staff",
                    "wallet_balance": float(wallet.balance) if wallet else None,
                }
        elif payer_kind == "department" and receipt.payer_department_id:
            from app.models.department import Department as _Dept
            d = db.query(_Dept).filter(_Dept.id == receipt.payer_department_id).first()
            if d:
                wallet = db.query(Wallet).filter(Wallet.department_id == d.id).first()
                payer_detail = {
                    "name": d.department_name,
                    "code": d.department_code,
                    "grade": None,
                    "photo_url": None,
                    "role": "department",
                    "wallet_balance": float(wallet.balance) if wallet else None,
                }

    return {
        "id": receipt.id,
        "receipt_number": receipt.receipt_number,
        "transaction_date": receipt.transaction_date,
        "transaction_mode": receipt.transaction_mode.value if receipt.transaction_mode else "sale",
        "customer_type_id": receipt.customer_type_id,
        "customer_id": receipt.customer_id,
        "payer_user_id": receipt.payer_user_id,
        "payer_department_id": receipt.payer_department_id,
        "payer_kind": payer_kind,
        "payer_label": payer_label,
        "payer_detail": payer_detail,
        "requester_user_id": getattr(receipt, "requester_user_id", None),
        "requester_name": requester_name,
        "shop_id": receipt.shop_id,
        "subtotal": float(receipt.subtotal),
        "discount": float(receipt.discount),
        "tax": float(receipt.tax),
        "total": float(receipt.total),
        "payment_method": receipt.payment_method.value if receipt.payment_method else "cash",
        "status": receipt.status.value if receipt.status else "active",
        "terminal_id": receipt.terminal_id,
        "notes": receipt.notes,
        "edc_terminal_ref": receipt.edc_terminal_ref,
        "edc_approval_code": receipt.edc_approval_code,
        "edc_masked_card": receipt.edc_masked_card,
        "created_at": receipt.created_at,
        "created_by": receipt.created_by,
        "voided_at": receipt.voided_at,
        "voided_by": receipt.voided_by,
        "voided_reason": receipt.voided_reason,
        "items": items,
    }
