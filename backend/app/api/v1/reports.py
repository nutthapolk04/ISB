"""
Reports API — sales, stock, returns aggregations for the Reports page.

Returns shapes ready for CSV export. All endpoints accept optional shop_id
to scope; admins can query any shop, others are clamped to their own.
"""
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

TZ_BKK = ZoneInfo("Asia/Bangkok")
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.customer import Customer, CustomerType
from app.models.product import Product, ProductVariant
from app.models.receipt import PaymentMethod, Receipt, ReceiptItem, ReceiptStatus
from app.models.return_request import ReturnRequest
from app.models.shop import Shop, ShopProduct, ShopMovement
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
    retail_total: float          # grand total EXCLUDING department rows
    department_total: float      # sum of DEPARTMENT rows only
    department_receipts: int     # count of DEPARTMENT receipts


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


class SalesSummaryRow(BaseModel):
    """One receipt rendered as a Sales Summary line.

    The Amt.* columns are mutually exclusive — only the column matching the
    receipt's payment method holds a value; the rest are 0. This matches the
    customer's reference report layout where each receipt occupies exactly
    one row with one payment-method column populated.
    """
    seq: int
    transaction_date: datetime
    receipt_number: str
    customer_id: Optional[str] = None     # student/parent code; null for guest sales
    customer_name: Optional[str] = None
    amt_receive: float                    # gross amount paid (= receipt total)
    amt_change: float                     # cash change returned (cash sales only)
    amt_billing: float                    # department billing amount
    amt_cash: float
    amt_campus_card: float                # wallet / card_tap
    amt_credit_card: float                # credit_card / debit_card / edc
    amt_qr_code: float                    # bank_transfer (PromptPay / QR)
    amt_other: float                      # OTHER + unknown payment methods
    remark: Optional[str] = None          # receipt.notes


class SalesSummaryTotals(BaseModel):
    amt_receive: float = 0.0
    amt_change: float = 0.0
    amt_billing: float = 0.0
    amt_cash: float = 0.0
    amt_campus_card: float = 0.0
    amt_credit_card: float = 0.0
    amt_qr_code: float = 0.0
    amt_other: float = 0.0


class SalesSummaryReport(BaseModel):
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    shop_id: Optional[str] = None
    rows: List[SalesSummaryRow]
    totals: SalesSummaryTotals
    receipt_count: int


class SalesByItemRow(BaseModel):
    """One ReceiptItem rendered as a Sales-by-Item line.

    Each row represents one product appearing on one receipt. A receipt with
    five line items produces five rows here, each carrying its own
    quantity and amount. Totals at the bottom sum across all rows so users
    can see total units sold and total amount within the active filter.
    """
    seq: int
    transaction_date: datetime
    item_no: Optional[str] = None       # ShopProduct.product_code (SKU)
    item_name: str
    receipt_number: str
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    sales_qty: float
    sales_amt: float
    receive_type: str                   # human-readable payment method label
    remark: Optional[str] = None        # receipt.notes


class SalesByItemTotals(BaseModel):
    sales_qty: float = 0.0
    sales_amt: float = 0.0


class SalesByItemReport(BaseModel):
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    shop_id: Optional[str] = None
    rows: List[SalesByItemRow]
    totals: SalesByItemTotals
    line_count: int


# ── Helpers ─────────────────────────────────────────────────────────────────

def _scope_shop(current_user: User, shop_id: Optional[str]) -> Optional[str]:
    """Admins can query any shop. Others fall back to their own shop."""
    if current_user.is_superuser or current_user.role == "admin":
        return shop_id
    own = getattr(current_user, "shop_id", None)
    if shop_id and shop_id != own:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not authorized for that shop")
    return own


def _effective_module(current_user: User, module: Optional[str]) -> Optional[str]:
    """For null-shop managers (area managers), derive the module filter.
    Single-shop users: no module filter needed (already scoped by shop_id).
    """
    if current_user.is_superuser or current_user.role == "admin":
        return module
    if getattr(current_user, "shop_id", None):
        return None  # single-shop user — shop_id already scopes the query
    own_module = getattr(current_user, "shop_module", None)
    return own_module or module


def _date_range(date_from: date, date_to: date) -> tuple[datetime, datetime]:
    """Convert date range to Asia/Bangkok datetime bounds (inclusive end of day)."""
    start = datetime.combine(date_from, time.min, tzinfo=TZ_BKK)
    end = datetime.combine(date_to, time.max, tzinfo=TZ_BKK)
    return start, end


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/sales", response_model=SalesReport)
def sales_report(
    date_from: date = Query(...),
    date_to: date = Query(...),
    shop_id: Optional[str] = Query(None),
    module: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    effective_shop_id = _scope_shop(current_user, shop_id)
    effective_module = None if effective_shop_id else _effective_module(current_user, module)
    start, end = _date_range(date_from, date_to)

    receipt_q = db.query(Receipt.id).filter(
        Receipt.transaction_date >= start,
        Receipt.transaction_date <= end,
        Receipt.status == ReceiptStatus.ACTIVE,
    )
    if effective_shop_id:
        receipt_q = receipt_q.filter(Receipt.shop_id == effective_shop_id)
    elif effective_module:
        module_shop_ids = [r[0] for r in db.query(Shop.id).filter(Shop.module == effective_module, Shop.is_active == True).all()]
        if module_shop_ids:
            receipt_q = receipt_q.filter(Receipt.shop_id.in_(module_shop_ids))

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
    module: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Sales report grouped by payment method."""
    effective_shop_id = _scope_shop(current_user, shop_id)
    effective_module = None if effective_shop_id else _effective_module(current_user, module)
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
    elif effective_module:
        module_shop_ids = [r[0] for r in db.query(Shop.id).filter(Shop.module == effective_module, Shop.is_active == True).all()]
        if module_shop_ids:
            q = q.filter(Receipt.shop_id.in_(module_shop_ids))

    agg = q.group_by(Receipt.payment_method).order_by(func.sum(Receipt.total).desc()).all()

    rows: List[SalesByPaymentRow] = []
    grand_total = 0.0
    total_receipts = 0
    retail_total = 0.0
    department_total = 0.0
    department_receipts = 0
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
        if method_name.upper() == "DEPARTMENT":
            department_total += line_total
            department_receipts += count
        else:
            retail_total += line_total

    return SalesByPaymentReport(
        date_from=date_from,
        date_to=date_to,
        shop_id=effective_shop_id,
        rows=rows,
        grand_total=grand_total,
        total_receipts=total_receipts,
        retail_total=retail_total,
        department_total=department_total,
        department_receipts=department_receipts,
    )


@router.get("/stock", response_model=StockReport)
def stock_report(
    shop_id: Optional[str] = Query(None),
    module: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    effective_shop_id = _scope_shop(current_user, shop_id)
    effective_module = None if effective_shop_id else _effective_module(current_user, module)

    q = (
        db.query(ShopProduct, Shop.name.label("shop_name"))
        .join(Shop, Shop.id == ShopProduct.shop_id)
        .filter(ShopProduct.is_active == True)  # noqa: E712
    )
    if effective_shop_id:
        q = q.filter(ShopProduct.shop_id == effective_shop_id)
    elif effective_module:
        q = q.filter(Shop.module == effective_module)

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
    module: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    effective_shop_id = _scope_shop(current_user, shop_id)
    effective_module = None if effective_shop_id else _effective_module(current_user, module)
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
    elif effective_module:
        module_shop_ids = {r[0] for r in db.query(Shop.id).filter(Shop.module == effective_module, Shop.is_active == True).all()}
        receipt_numbers_q = db.query(Receipt.receipt_number).filter(Receipt.shop_id.in_(module_shop_ids))
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


# ── Stock Card ───────────────────────────────────────────────────────────────

class StockCardRow(BaseModel):
    """One line in the per-product stockcard.

    `date` and `invoice_no` are None for synthetic Beginning/Closing rows.
    Quantity is split into in/out columns so a printed report can show
    both sides of each movement without a separate sign indicator.
    """

    date: Optional[datetime]
    description: str
    invoice_no: Optional[str]
    qty_in: float
    qty_out: float
    qty_balance: float
    amount_in: float
    amount_out: float
    cost_per_unit: float
    amount_balance: float


class StockCardProductBlock(BaseModel):
    product_variant_id: int
    product_code: str
    product_name: str
    rows: List[StockCardRow]
    total_qty_in: float
    total_qty_out: float
    total_amount_in: float
    total_amount_out: float


class StockCardReport(BaseModel):
    shop_id: Optional[str]
    shop_name: Optional[str]
    date_from: date
    date_to: date
    products: List[StockCardProductBlock]


# Human-readable label per MovementType for the "Description" column in the
# printed report. Kept here so the on-screen and exported PDF match.
_MOVEMENT_DESCRIPTION: dict[str, str] = {
    "receive": "Receive",
    "sale": "Sales",
    "adjustment": "Adjustment",
    "internal_use": "Internal Use",
    "void": "Return",
    "exchange": "Exchange",
}


def _build_product_block(
    db: Session,
    shop_product: ShopProduct,
    date_from: date,
    date_to: date,
) -> StockCardProductBlock:
    """Compose Beginning + movement rows + Closing for one SKU."""
    start, end = _date_range(date_from, date_to)
    start_bkk = datetime.combine(date_from, time.min, tzinfo=TZ_BKK)

    # Opening balance: stock_after of the last movement BEFORE date_from.
    last_before = (
        db.query(ShopMovement)
        .filter(
            ShopMovement.product_id == shop_product.id,
            ShopMovement.created_at < start_bkk,
        )
        .order_by(ShopMovement.created_at.desc())
        .first()
    )
    opening_qty = float(last_before.stock_after) if last_before else float(shop_product.stock or 0)
    opening_cost = (
        float(last_before.cost_per_unit)
        if last_before and last_before.cost_per_unit is not None
        else float(shop_product.avg_cost or 0)
    )

    movements = (
        db.query(ShopMovement)
        .filter(
            ShopMovement.product_id == shop_product.id,
            ShopMovement.created_at >= start,
            ShopMovement.created_at <= end,
        )
        .order_by(ShopMovement.created_at)
        .all()
    )

    rows: List[StockCardRow] = [
        StockCardRow(
            date=None,
            description="Beginning Balance",
            invoice_no=None,
            qty_in=0,
            qty_out=0,
            qty_balance=opening_qty,
            amount_in=0,
            amount_out=0,
            cost_per_unit=opening_cost,
            amount_balance=round(opening_qty * opening_cost, 2),
        )
    ]

    total_qty_in = 0.0
    total_qty_out = 0.0
    total_amount_in = 0.0
    total_amount_out = 0.0
    last_cost = opening_cost

    for m in movements:
        type_str = m.type.value if hasattr(m.type, "value") else str(m.type)
        signed_qty = float(m.quantity)
        cost = float(m.cost_per_unit) if m.cost_per_unit is not None else last_cost
        if signed_qty >= 0:
            qty_in, qty_out = signed_qty, 0.0
            amount_in, amount_out = round(signed_qty * cost, 2), 0.0
        else:
            qty_in, qty_out = 0.0, -signed_qty
            amount_in, amount_out = 0.0, round(-signed_qty * cost, 2)
        balance_qty = float(m.stock_after)
        rows.append(
            StockCardRow(
                date=m.created_at,
                description=_MOVEMENT_DESCRIPTION.get(type_str, type_str),
                invoice_no=m.reference,
                qty_in=qty_in,
                qty_out=qty_out,
                qty_balance=balance_qty,
                amount_in=amount_in,
                amount_out=amount_out,
                cost_per_unit=cost,
                amount_balance=round(balance_qty * cost, 2),
            )
        )
        total_qty_in += qty_in
        total_qty_out += qty_out
        total_amount_in += amount_in
        total_amount_out += amount_out
        last_cost = cost

    closing_qty = float(movements[-1].stock_after) if movements else opening_qty
    rows.append(
        StockCardRow(
            date=None,
            description="Closing Balance",
            invoice_no=None,
            qty_in=0,
            qty_out=0,
            qty_balance=closing_qty,
            amount_in=0,
            amount_out=0,
            cost_per_unit=last_cost,
            amount_balance=round(closing_qty * last_cost, 2),
        )
    )

    return StockCardProductBlock(
        product_variant_id=shop_product.id,
        product_code=shop_product.product_code or "",
        product_name=shop_product.name,
        rows=rows,
        total_qty_in=total_qty_in,
        total_qty_out=total_qty_out,
        total_amount_in=round(total_amount_in, 2),
        total_amount_out=round(total_amount_out, 2),
    )


@router.get("/stock-card", response_model=StockCardReport)
def stock_card_report(
    date_from: date = Query(...),
    date_to: date = Query(...),
    shop_id: Optional[str] = Query(None),
    product_variant_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Multi-product stockcard (default) or single SKU mode.

    Modes:
      - product_variant_id set → returns one block for that SKU only.
      - shop_id set → returns one block per active product in the shop that
        has any movement OR a non-zero opening balance during the range.

    ShopMovement is the live audit table written by checkout, void, returns,
    and inventory adjustments.
    """
    scoped_shop_id = _scope_shop(current_user, shop_id)

    if product_variant_id is not None:
        shop_product = (
            db.query(ShopProduct)
            .filter(ShopProduct.id == product_variant_id, ShopProduct.is_active == True)  # noqa: E712
            .first()
        )
        if not shop_product:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Product not found")
        if scoped_shop_id and shop_product.shop_id != scoped_shop_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Product not in your shop")
        target_products = [shop_product]
        effective_shop_id = shop_product.shop_id
    else:
        if not scoped_shop_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="shop_id is required when product_variant_id is not provided",
            )
        target_products = (
            db.query(ShopProduct)
            .filter(ShopProduct.shop_id == scoped_shop_id, ShopProduct.is_active == True)  # noqa: E712
            .order_by(ShopProduct.product_code, ShopProduct.id)
            .all()
        )
        effective_shop_id = scoped_shop_id

    blocks = [_build_product_block(db, p, date_from, date_to) for p in target_products]
    # When listing the whole shop, hide rows that are completely empty in the
    # range (no movement and zero opening balance) so the report stays compact.
    if product_variant_id is None:
        blocks = [
            b
            for b in blocks
            if b.total_qty_in or b.total_qty_out or b.rows[0].qty_balance
        ]

    shop_name: Optional[str] = None
    if effective_shop_id:
        shop = db.query(Shop).filter(Shop.id == effective_shop_id).first()
        shop_name = shop.name if shop else None

    return StockCardReport(
        shop_id=effective_shop_id,
        shop_name=shop_name,
        date_from=date_from,
        date_to=date_to,
        products=blocks,
    )


# ── Sales Summary Report ────────────────────────────────────────────────────

# Map the high-level "receive type" filter (frontend dropdown) to the set of
# concrete PaymentMethod enum values that should match. Kept here as a single
# source of truth so the row-rendering loop and the filter clause agree.
_RECEIVE_TYPE_GROUPS: dict[str, list[PaymentMethod]] = {
    "cash": [PaymentMethod.CASH],
    "wallet": [PaymentMethod.WALLET, PaymentMethod.CARD_TAP],
    "credit": [PaymentMethod.CREDIT_CARD, PaymentMethod.DEBIT_CARD, PaymentMethod.EDC],
    "qr": [PaymentMethod.BANK_TRANSFER],
    "department": [PaymentMethod.DEPARTMENT],
    "other": [PaymentMethod.OTHER],
}


def _amount_column_for(method: PaymentMethod) -> str:
    """Return the SalesSummaryRow column key that a given payment method
    populates. Unknown methods fall through to amt_other so totals stay
    consistent even when the enum grows."""
    if method == PaymentMethod.CASH:
        return "amt_cash"
    if method in (PaymentMethod.WALLET, PaymentMethod.CARD_TAP):
        return "amt_campus_card"
    if method in (PaymentMethod.CREDIT_CARD, PaymentMethod.DEBIT_CARD, PaymentMethod.EDC):
        return "amt_credit_card"
    if method == PaymentMethod.BANK_TRANSFER:
        return "amt_qr_code"
    if method == PaymentMethod.DEPARTMENT:
        return "amt_billing"
    return "amt_other"


@router.get("/sales-summary", response_model=SalesSummaryReport)
def sales_summary_report(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    customer_type: Optional[str] = Query(None, description="parent | student | staff | guest | all"),
    user_name: Optional[str] = Query(None, description="case-insensitive substring on customer/payer name"),
    family_code: Optional[str] = Query(None),
    receipt_no_from: Optional[str] = Query(None),
    receipt_no_to: Optional[str] = Query(None),
    receive_type: Optional[str] = Query(None, description="cash | wallet | credit | qr | department | other | all"),
    shop_id: Optional[str] = Query(None),
    module: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Per-receipt sales summary with payment-method breakdown.

    Every filter is optional — leaving them blank returns every active
    receipt visible to the caller (admin sees all shops, others see their
    own). Designed to back the Sales Summary export on the Reports page.
    """
    # ── Scope ─────────────────────────────────────────────────────────────
    effective_shop_id = _scope_shop(current_user, shop_id)
    effective_module = None if effective_shop_id else _effective_module(current_user, module)

    q = db.query(Receipt).filter(Receipt.status == ReceiptStatus.ACTIVE)

    # ── Date range (both ends optional) ───────────────────────────────────
    if date_from:
        start = datetime.combine(date_from, time.min, tzinfo=TZ_BKK)
        q = q.filter(Receipt.transaction_date >= start)
    if date_to:
        end = datetime.combine(date_to, time.max, tzinfo=TZ_BKK)
        q = q.filter(Receipt.transaction_date <= end)

    # ── Shop / module scope ───────────────────────────────────────────────
    if effective_shop_id:
        q = q.filter(Receipt.shop_id == effective_shop_id)
    elif effective_module:
        module_shop_ids = [
            r[0]
            for r in db.query(Shop.id)
            .filter(Shop.module == effective_module, Shop.is_active == True)  # noqa: E712
            .all()
        ]
        if module_shop_ids:
            q = q.filter(Receipt.shop_id.in_(module_shop_ids))

    # ── Receipt number range (string compare; treat as opaque IDs) ────────
    if receipt_no_from:
        q = q.filter(Receipt.receipt_number >= receipt_no_from)
    if receipt_no_to:
        q = q.filter(Receipt.receipt_number <= receipt_no_to)

    # ── Payment method ────────────────────────────────────────────────────
    if receive_type and receive_type != "all":
        methods = _RECEIVE_TYPE_GROUPS.get(receive_type)
        if methods:
            q = q.filter(Receipt.payment_method.in_(methods))

    # ── Customer joins (only when filter requires them) ───────────────────
    # Done as outer joins so receipts without a linked customer (guest sale)
    # still pass through when no customer filter is active.
    needs_customer_join = bool(customer_type or user_name or family_code)
    if needs_customer_join:
        q = q.outerjoin(Customer, Customer.id == Receipt.customer_id)

    if customer_type and customer_type != "all":
        q = q.outerjoin(CustomerType, CustomerType.id == Customer.customer_type_id).filter(
            CustomerType.type_name == customer_type
        )

    if family_code:
        # family_code lives on Customer (students) AND User (staff/parents).
        # For sales report purposes we match the customer side; payer-side
        # filtering is rare and noisy. Substring match is a footgun on a
        # 20-char code, so use equality.
        q = q.filter(Customer.family_code == family_code)

    if user_name:
        # Match either the linked customer's name OR the payer user's name.
        # Outer-join payer_user so receipts with no payer link still pass.
        q = q.outerjoin(User, User.id == Receipt.payer_user_id).filter(
            (Customer.name.ilike(f"%{user_name}%")) | (User.full_name.ilike(f"%{user_name}%"))
        )

    receipts = q.order_by(Receipt.transaction_date.asc(), Receipt.id.asc()).all()

    # ── Build rows + running totals ───────────────────────────────────────
    rows: List[SalesSummaryRow] = []
    totals_dict = {
        "amt_receive": 0.0, "amt_change": 0.0, "amt_billing": 0.0,
        "amt_cash": 0.0, "amt_campus_card": 0.0, "amt_credit_card": 0.0,
        "amt_qr_code": 0.0, "amt_other": 0.0,
    }

    for i, r in enumerate(receipts, start=1):
        amt_receive = float(r.total or 0)

        # Cash change only applies when payment is cash and we recorded the
        # tendered amount. Other methods always have 0 change.
        amt_change = 0.0
        if r.payment_method == PaymentMethod.CASH and r.cash_received is not None:
            amt_change = max(float(r.cash_received) - amt_receive, 0.0)

        # Customer identity — prefer the linked Customer (students/parents).
        # Fall back to payer_user (staff/teacher charging their own wallet),
        # then to None for guest cash sales.
        cust_id: Optional[str] = None
        cust_name: Optional[str] = None
        if r.customer is not None:
            cust_id = r.customer.customer_code
            cust_name = r.customer.name
        elif r.payer_user is not None:
            cust_id = getattr(r.payer_user, "external_id", None) or r.payer_user.username
            cust_name = r.payer_user.full_name

        # Allocate the receipt amount into exactly one Amt.* bucket.
        col = _amount_column_for(r.payment_method)
        row_amounts = {
            "amt_billing": 0.0, "amt_cash": 0.0, "amt_campus_card": 0.0,
            "amt_credit_card": 0.0, "amt_qr_code": 0.0, "amt_other": 0.0,
        }
        row_amounts[col] = amt_receive

        rows.append(SalesSummaryRow(
            seq=i,
            transaction_date=r.transaction_date,
            receipt_number=r.receipt_number,
            customer_id=cust_id,
            customer_name=cust_name,
            amt_receive=amt_receive,
            amt_change=amt_change,
            remark=r.notes,
            **row_amounts,
        ))

        totals_dict["amt_receive"] += amt_receive
        totals_dict["amt_change"] += amt_change
        totals_dict[col] += amt_receive

    return SalesSummaryReport(
        date_from=date_from,
        date_to=date_to,
        shop_id=effective_shop_id,
        rows=rows,
        totals=SalesSummaryTotals(**totals_dict),
        receipt_count=len(rows),
    )


# ── Sales by Item Report ────────────────────────────────────────────────────

# Human-readable label for each payment method. Used in the "Receive Type"
# column of Sales by Item — the customer's reference report shows the
# method as plain text rather than a code.
_PAYMENT_METHOD_LABEL: dict[PaymentMethod, str] = {
    PaymentMethod.CASH:          "Cash",
    PaymentMethod.WALLET:        "Campus Card",
    PaymentMethod.CARD_TAP:      "Campus Card",
    PaymentMethod.CREDIT_CARD:   "Credit Card",
    PaymentMethod.DEBIT_CARD:    "Credit Card",
    PaymentMethod.EDC:           "Credit Card",
    PaymentMethod.BANK_TRANSFER: "QR Code",
    PaymentMethod.DEPARTMENT:    "Department",
    PaymentMethod.OTHER:         "Other",
}


@router.get("/sales-by-item", response_model=SalesByItemReport)
def sales_by_item_report(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    user_name: Optional[str] = Query(None, description="case-insensitive substring on customer/payer name"),
    category_code: Optional[str] = Query(None, description="ShopProduct.category exact match"),
    item_no_from: Optional[str] = Query(None, description="ShopProduct.product_code lower bound"),
    item_no_to: Optional[str] = Query(None, description="ShopProduct.product_code upper bound"),
    shop_id: Optional[str] = Query(None),
    module: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Per-item sales activity across receipts.

    Each row = one ReceiptItem. Every filter is optional. Designed to back
    the Sales by Item export on the Reports page.
    """
    # ── Scope ─────────────────────────────────────────────────────────────
    effective_shop_id = _scope_shop(current_user, shop_id)
    effective_module = None if effective_shop_id else _effective_module(current_user, module)

    # Base query joins ReceiptItem → Receipt + ShopProduct so we can filter
    # on both sides in one pass. Outer-join Customer so receipts without a
    # linked customer (guest sales) still appear unless a customer filter
    # narrows them out.
    q = (
        db.query(ReceiptItem, Receipt, ShopProduct, Customer)
        .join(Receipt, Receipt.id == ReceiptItem.receipt_id)
        .join(ShopProduct, ShopProduct.id == ReceiptItem.product_variant_id)
        .outerjoin(Customer, Customer.id == Receipt.customer_id)
        .filter(Receipt.status == ReceiptStatus.ACTIVE)
    )

    # ── Date range (both ends optional) ───────────────────────────────────
    if date_from:
        start = datetime.combine(date_from, time.min, tzinfo=TZ_BKK)
        q = q.filter(Receipt.transaction_date >= start)
    if date_to:
        end = datetime.combine(date_to, time.max, tzinfo=TZ_BKK)
        q = q.filter(Receipt.transaction_date <= end)

    # ── Shop / module scope ───────────────────────────────────────────────
    if effective_shop_id:
        q = q.filter(Receipt.shop_id == effective_shop_id)
    elif effective_module:
        module_shop_ids = [
            r[0]
            for r in db.query(Shop.id)
            .filter(Shop.module == effective_module, Shop.is_active == True)  # noqa: E712
            .all()
        ]
        if module_shop_ids:
            q = q.filter(Receipt.shop_id.in_(module_shop_ids))

    # ── Customer name (also matches payer user) ───────────────────────────
    if user_name:
        # Need an outer-join on payer_user for the OR condition. Using a
        # separate alias-less join is safe here because we don't already
        # join the User table elsewhere in this query.
        q = q.outerjoin(User, User.id == Receipt.payer_user_id).filter(
            (Customer.name.ilike(f"%{user_name}%")) | (User.full_name.ilike(f"%{user_name}%"))
        )

    # ── Category + item number filters (on ShopProduct) ───────────────────
    if category_code:
        q = q.filter(ShopProduct.category == category_code)
    if item_no_from:
        q = q.filter(ShopProduct.product_code >= item_no_from)
    if item_no_to:
        q = q.filter(ShopProduct.product_code <= item_no_to)

    rows_raw = q.order_by(Receipt.transaction_date.asc(), Receipt.id.asc(), ReceiptItem.id.asc()).all()

    # ── Build rows + running totals ───────────────────────────────────────
    rows: List[SalesByItemRow] = []
    total_qty = 0.0
    total_amt = 0.0
    for i, (item, receipt, product, customer) in enumerate(rows_raw, start=1):
        qty = float(item.quantity or 0)
        amt = float(item.line_total or 0)

        cust_id: Optional[str] = None
        cust_name: Optional[str] = None
        if customer is not None:
            cust_id = customer.customer_code
            cust_name = customer.name
        elif receipt.payer_user is not None:
            cust_id = getattr(receipt.payer_user, "external_id", None) or receipt.payer_user.username
            cust_name = receipt.payer_user.full_name

        rows.append(SalesByItemRow(
            seq=i,
            transaction_date=receipt.transaction_date,
            item_no=product.product_code,
            item_name=product.name,
            receipt_number=receipt.receipt_number,
            customer_id=cust_id,
            customer_name=cust_name,
            sales_qty=qty,
            sales_amt=amt,
            receive_type=_PAYMENT_METHOD_LABEL.get(receipt.payment_method, "Other"),
            remark=receipt.notes,
        ))
        total_qty += qty
        total_amt += amt

    return SalesByItemReport(
        date_from=date_from,
        date_to=date_to,
        shop_id=effective_shop_id,
        rows=rows,
        totals=SalesByItemTotals(sales_qty=total_qty, sales_amt=total_amt),
        line_count=len(rows),
    )
