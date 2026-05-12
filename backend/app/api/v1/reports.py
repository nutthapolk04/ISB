"""
Reports API — sales, stock, returns aggregations for the Reports page.

Returns shapes ready for CSV export. All endpoints accept optional shop_id
to scope; admins can query any shop, others are clamped to their own.
"""
from datetime import date, datetime, time, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.receipt import Receipt, ReceiptItem, ReceiptStatus
from app.models.return_request import ReturnRequest
from app.models.shop import Shop, ShopProduct
from app.models.user import User

router = APIRouter()


# ── Schemas ─────────────────────────────────────────────────────────────────

class SalesRow(BaseModel):
    product_name: str
    quantity: int
    total: float


class SalesByPaymentRow(BaseModel):
    payment_method: str
    receipt_count: int
    total: float


class SalesByPaymentReport(BaseModel):
    date_from: date
    date_to: date
    shop_id: Optional[str]
    rows: List[SalesByPaymentRow]
    grand_total: float
    total_receipts: int


class SalesReport(BaseModel):
    date_from: date
    date_to: date
    shop_id: Optional[str]
    rows: List[SalesRow]
    grand_total: float
    receipt_count: int


class StockRow(BaseModel):
    product_code: Optional[str]
    product_name: str
    stock_qty: float
    shop_id: str
    shop_name: Optional[str]


class StockReport(BaseModel):
    shop_id: Optional[str]
    rows: List[StockRow]


class ReturnRow(BaseModel):
    id: int
    return_date: datetime
    receipt_number: str
    product_name: str
    quantity: int
    refund_amount: float
    exchange_amount: float
    status: str


class ReturnReport(BaseModel):
    date_from: date
    date_to: date
    shop_id: Optional[str]
    rows: List[ReturnRow]
    total_refund: float
    total_exchange: float


# ── Helpers ─────────────────────────────────────────────────────────────────

def _scope_shop(current_user: User, shop_id: Optional[str]) -> Optional[str]:
    """Admins can query any shop. Others fall back to their own shop."""
    if current_user.is_superuser or current_user.role == "admin":
        return shop_id
    own = getattr(current_user, "shop_id", None)
    if shop_id and shop_id != own:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not authorized for that shop")
    return own


def _date_range(date_from: date, date_to: date) -> tuple[datetime, datetime]:
    """Convert date range to UTC datetime bounds (inclusive end of day)."""
    start = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
    end = datetime.combine(date_to, time.max, tzinfo=timezone.utc)
    return start, end


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/sales", response_model=SalesReport)
def sales_report(
    date_from: date = Query(...),
    date_to: date = Query(...),
    shop_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    effective_shop_id = _scope_shop(current_user, shop_id)
    start, end = _date_range(date_from, date_to)

    receipt_q = db.query(Receipt.id).filter(
        Receipt.transaction_date >= start,
        Receipt.transaction_date <= end,
        Receipt.status == ReceiptStatus.ACTIVE,
    )
    if effective_shop_id:
        receipt_q = receipt_q.filter(Receipt.shop_id == effective_shop_id)

    receipt_ids = [row[0] for row in receipt_q.all()]

    rows: List[SalesRow] = []
    grand_total = 0.0
    if receipt_ids:
        agg = (
            db.query(
                ShopProduct.name.label("name"),
                func.sum(ReceiptItem.quantity).label("qty"),
                func.sum(ReceiptItem.line_total).label("total"),
            )
            .join(ShopProduct, ShopProduct.id == ReceiptItem.product_variant_id)
            .filter(ReceiptItem.receipt_id.in_(receipt_ids))
            .group_by(ShopProduct.name)
            .order_by(func.sum(ReceiptItem.line_total).desc())
            .all()
        )
        for r in agg:
            line_total = float(r.total or 0)
            rows.append(SalesRow(product_name=r.name, quantity=int(r.qty or 0), total=line_total))
            grand_total += line_total

    return SalesReport(
        date_from=date_from,
        date_to=date_to,
        shop_id=effective_shop_id,
        rows=rows,
        grand_total=grand_total,
        receipt_count=len(receipt_ids),
    )


@router.get("/sales-by-payment", response_model=SalesByPaymentReport)
def sales_by_payment_report(
    date_from: date = Query(...),
    date_to: date = Query(...),
    shop_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Sales report grouped by payment method."""
    effective_shop_id = _scope_shop(current_user, shop_id)
    start, end = _date_range(date_from, date_to)

    q = db.query(
        Receipt.payment_method,
        func.count(Receipt.id).label("receipt_count"),
        func.sum(Receipt.total).label("total"),
    ).filter(
        Receipt.transaction_date >= start,
        Receipt.transaction_date <= end,
        Receipt.status == ReceiptStatus.ACTIVE,
    )

    if effective_shop_id:
        q = q.filter(Receipt.shop_id == effective_shop_id)

    agg = q.group_by(Receipt.payment_method).order_by(func.sum(Receipt.total).desc()).all()

    rows: List[SalesByPaymentRow] = []
    grand_total = 0.0
    total_receipts = 0
    for r in agg:
        method_name = r.payment_method.value if hasattr(r.payment_method, 'value') else str(r.payment_method)
        line_total = float(r.total or 0)
        count = int(r.receipt_count or 0)
        rows.append(SalesByPaymentRow(
            payment_method=method_name,
            receipt_count=count,
            total=line_total,
        ))
        grand_total += line_total
        total_receipts += count

    return SalesByPaymentReport(
        date_from=date_from,
        date_to=date_to,
        shop_id=effective_shop_id,
        rows=rows,
        grand_total=grand_total,
        total_receipts=total_receipts,
    )


@router.get("/stock", response_model=StockReport)
def stock_report(
    shop_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    effective_shop_id = _scope_shop(current_user, shop_id)

    q = (
        db.query(ShopProduct, Shop.name.label("shop_name"))
        .join(Shop, Shop.id == ShopProduct.shop_id)
        .filter(ShopProduct.is_active == True)  # noqa: E712
    )
    if effective_shop_id:
        q = q.filter(ShopProduct.shop_id == effective_shop_id)

    rows: List[StockRow] = []
    for product, shop_name in q.order_by(ShopProduct.shop_id, ShopProduct.name).all():
        rows.append(
            StockRow(
                product_code=product.product_code,
                product_name=product.name,
                stock_qty=float(product.stock or 0),
                shop_id=product.shop_id,
                shop_name=shop_name,
            )
        )

    return StockReport(shop_id=effective_shop_id, rows=rows)


@router.get("/returns", response_model=ReturnReport)
def returns_report(
    date_from: date = Query(...),
    date_to: date = Query(...),
    shop_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    effective_shop_id = _scope_shop(current_user, shop_id)
    start, end = _date_range(date_from, date_to)

    # ReturnRequest.receipt_id stores receipt_number (string), not the FK id.
    q = db.query(ReturnRequest).filter(
        ReturnRequest.created_at >= start,
        ReturnRequest.created_at <= end,
    )

    if effective_shop_id:
        # Filter to receipts of this shop by joining via receipt_number.
        receipt_numbers_q = db.query(Receipt.receipt_number).filter(
            Receipt.shop_id == effective_shop_id
        )
        receipt_numbers = {row[0] for row in receipt_numbers_q.all()}
        rows_raw = [r for r in q.order_by(ReturnRequest.created_at.desc()).all()
                    if r.receipt_id in receipt_numbers]
    else:
        rows_raw = q.order_by(ReturnRequest.created_at.desc()).all()

    rows: List[ReturnRow] = []
    total_refund = 0.0
    total_exchange = 0.0
    for ret in rows_raw:
        refund = float(ret.refund_amount or 0)
        exchange = float(ret.exchange_amount or 0)
        total_refund += refund
        total_exchange += exchange
        status_str = ret.status.value if hasattr(ret.status, "value") else str(ret.status)
        rows.append(
            ReturnRow(
                id=ret.id,
                return_date=ret.created_at,
                receipt_number=ret.receipt_id,  # actually receipt_number
                product_name=ret.product_name,
                quantity=int(ret.return_quantity or 0),
                refund_amount=refund,
                exchange_amount=exchange,
                status=status_str,
            )
        )

    return ReturnReport(
        date_from=date_from,
        date_to=date_to,
        shop_id=effective_shop_id,
        rows=rows,
        total_refund=total_refund,
        total_exchange=total_exchange,
    )
