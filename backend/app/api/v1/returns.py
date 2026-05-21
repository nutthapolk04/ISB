"""
Returns & Exchange API Routes
POST   /api/v1/returns/create          — create return request(s)
GET    /api/v1/returns                 — list return requests
GET    /api/v1/returns/{id}            — get single return
PUT    /api/v1/returns/{id}            — update return (status, fields)
DELETE /api/v1/returns/{id}            — delete return request
POST   /api/v1/returns/{id}/refund     — process refund
POST   /api/v1/returns/{id}/exchange   — process exchange
GET    /api/v1/return-history          — processed returns history
GET    /api/v1/receipts/search         — search receipts for return lookup
GET    /api/v1/products/available      — in-stock products for exchange
"""
from datetime import date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user, require_role
from app.models.user import User
from app.models.shop import ShopProduct
from app.schemas.returns import (
    CreateReturnRequest,
    CreateReturnWithoutReceiptRequest,
    UpdateReturnRequest,
    ProcessRefundRequest,
    ProcessExchangeRequest,
    ReturnRequestResponse,
    ReturnHistoryResponse,
    RefundResponse,
    ExchangeResponse,
)
from app.services.returns_service import ReturnsService

router = APIRouter()


# ── Return CRUD ──────────────────────────────────────────────────────────────

@router.post("/returns/create", response_model=List[ReturnRequestResponse])
def create_return(
    payload: CreateReturnRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    """Create one or more return requests from a receipt."""
    items = [item.model_dump() for item in payload.items]
    try:
        returns = ReturnsService.create_return(
            db,
            receipt_id=payload.receiptId,
            items=items,
            reason=payload.reason,
            user_id=current_user.id,
        )
        return [_rr_to_response(rr) for rr in returns]
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


@router.post("/returns/create-without-receipt", response_model=List[ReturnRequestResponse])
def create_return_without_receipt(
    payload: CreateReturnWithoutReceiptRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    """Create return requests without linking to a specific receipt.

    Used when customer doesn't have a receipt but product is confirmed as store merchandise.
    Stock will be returned to inventory upon approval.
    """
    items = [item.model_dump() for item in payload.items]
    try:
        returns = ReturnsService.create_return_without_receipt(
            db,
            items=items,
            reason=payload.reason,
            customer_name=payload.customerName,
            notes=payload.notes,
            user_id=current_user.id,
        )
        return [_rr_to_response(rr) for rr in returns]
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/returns", response_model=List[ReturnRequestResponse])
def list_returns(
    filter: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    """List all return requests."""
    returns = ReturnsService.list_returns(db, q=filter)
    return [_rr_to_response(rr) for rr in returns]


@router.get("/returns/by-receipt", response_model=List[ReturnRequestResponse])
def get_returns_by_receipt(
    receiptId: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    """Get all active (non-rejected) return requests for a specific receipt."""
    returns = ReturnsService.get_returns_by_receipt_id(db, receiptId)
    return [_rr_to_response(rr) for rr in returns]


@router.get("/returns/{return_id}", response_model=ReturnRequestResponse)
def get_return(
    return_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    rr = ReturnsService.get_return(db, return_id)
    if not rr:
        raise HTTPException(status_code=404, detail="Return request not found")
    return _rr_to_response(rr)


@router.put("/returns/{return_id}", response_model=ReturnRequestResponse)
def update_return(
    return_id: int,
    payload: UpdateReturnRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    """Update return request fields or change status (approve/reject)."""
    fields = payload.model_dump(exclude_none=True)
    # Convert enum to string
    if "status" in fields:
        fields["status"] = fields["status"].value if hasattr(fields["status"], "value") else fields["status"]
    if "priceType" in fields:
        fields["priceType"] = fields["priceType"].value if hasattr(fields["priceType"], "value") else fields["priceType"]

    rr = ReturnsService.update_return(db, return_id, **fields)
    if not rr:
        raise HTTPException(status_code=404, detail="Return request not found")
    return _rr_to_response(rr)


@router.delete("/returns/{return_id}")
def delete_return(
    return_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    ok = ReturnsService.delete_return(db, return_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Return request not found")
    return {"success": True}


# ── Refund & Exchange ────────────────────────────────────────────────────────

@router.post("/returns/{return_id}/refund", response_model=RefundResponse)
def process_refund(
    return_id: int,
    payload: ProcessRefundRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    try:
        result = ReturnsService.process_refund(
            db,
            return_id,
            return_items=[i.model_dump() for i in payload.returnItems],
            refund_method=payload.refundMethod.value if payload.refundMethod else None,
            reason=payload.reason,
            notes=payload.notes,
            user_id=current_user.id,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/returns/{return_id}/exchange", response_model=ExchangeResponse)
def process_exchange(
    return_id: int,
    payload: ProcessExchangeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    try:
        result = ReturnsService.process_exchange(
            db,
            return_id,
            return_items=[i.model_dump() for i in payload.returnItems],
            exchange_items=[i.model_dump() for i in payload.exchangeItems],
            difference=payload.difference,
            reason=payload.reason,
            notes=payload.notes,
            user_id=current_user.id,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Return History ───────────────────────────────────────────────────────────

@router.get("/return-history", response_model=List[ReturnHistoryResponse])
def get_return_history(
    filter: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    return ReturnsService.get_return_history(db, q=filter)


# ── Receipt Search (for return page) ────────────────────────────────────────

@router.get("/receipts/search")
def search_receipts(
    receiptId: Optional[str] = Query(None),
    studentCode: Optional[str] = Query(None, description="Search by student_code or customer_code"),
    dateFrom: Optional[date] = Query(None, description="Filter by transaction_date >= dateFrom"),
    dateTo: Optional[date] = Query(None, description="Filter by transaction_date <= dateTo"),
    paymentMethod: Optional[str] = Query(None, description="cash | wallet | department | edc | qr | all"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    """Search receipts for the return flow.

    Returns:
      - receipts: list of matching receipts (may be empty)
      - receipt:  shortcut for the single match (None when 0 or >1 results) — preserves
                  the legacy contract used by exact-match flows.
    """
    if not any([receiptId, studentCode, dateFrom, dateTo, paymentMethod]):
        raise HTTPException(status_code=400, detail="At least one search criterion is required")

    results = ReturnsService.search_receipts(
        db,
        receipt_id=receiptId,
        student_code=studentCode,
        date_from=dateFrom,
        date_to=dateTo,
        payment_method=paymentMethod,
    )
    if not results:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return {
        "receipts": results,
        "receipt": results[0] if len(results) == 1 else None,
    }


# ── Available Products (for exchange selection) ──────────────────────────────

@router.get("/exchange/products")
def get_available_products(
    inStock: bool = Query(True),
    shop_id: Optional[str] = Query(None, description="Filter by shop ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    """Get list of available products for exchange. Filter by shop_id to show same-shop products only."""
    query = db.query(ShopProduct).filter(ShopProduct.is_active == True)
    if shop_id:
        query = query.filter(ShopProduct.shop_id == shop_id)
    if inStock:
        query = query.filter(ShopProduct.stock > 0)
    products = query.all()
    return [
        {
            "productCode": p.product_code,
            "productName": p.name,
            "quantity": p.stock,
            "price": float(p.external_price),
        }
        for p in products
    ]


# ── Helpers ──────────────────────────────────────────────────────────────────

def _rr_to_response(rr) -> dict:
    return {
        "id": rr.id,
        "receiptId": rr.receipt_id,
        "productCode": rr.product_code,
        "productName": rr.product_name,
        "quantity": rr.quantity,
        "returnQuantity": rr.return_quantity,
        "reason": rr.reason,
        "status": rr.status.value if hasattr(rr.status, "value") else rr.status,
        "date": rr.created_at.strftime("%Y-%m-%d") if rr.created_at else "",
        "priceType": rr.price_type or "normal",
        "voidStatus": rr.void_status or "active",
        "returnStatus": rr.return_status or "no-return",
    }
