"""
POS Checkout Schemas
"""
from typing import Any, Literal, Optional, List
from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum


# ── Enums ────────────────────────────────────────────────────────────────────

class TransactionMode(str, Enum):
    SALE = "sale"
    INTERNAL_ISSUE = "internal_issue"


class PaymentMethod(str, Enum):
    CASH = "cash"
    CREDIT_CARD = "credit_card"
    DEBIT_CARD = "debit_card"
    WALLET = "wallet"
    BANK_TRANSFER = "bank_transfer"
    CARD_TAP = "card_tap"           # MIFARE/NFC tap → charges wallet
    EDC = "edc"                     # External card terminal
    DEPARTMENT = "department"       # Internal issue charged to department budget
    OTHER = "other"


class ReceiptStatus(str, Enum):
    ACTIVE = "active"
    VOIDED = "voided"


# ── Checkout Request ─────────────────────────────────────────────────────────

class SelectedOption(BaseModel):
    """A single menu option selected on a line item.

    quantity is only meaningful for OptionSelectionType.quantity; for
    single/multi the server treats it as 1.
    """
    option_id: int
    quantity: int = Field(default=1, ge=1)


class CheckoutItemPayload(BaseModel):
    product_variant_id: int
    quantity: int = Field(ge=1)
    # Base product price (options add to the line total at the server).
    unit_price: float = Field(ge=0)
    # Cashier-entered one-time override. When present (>=0), it replaces
    # `unit_price` for line-total math. `unit_price` is still recorded for
    # audit so we can spot the diff on the receipt.
    price_override: Optional[float] = Field(default=None, ge=0)
    discount: float = Field(default=0, ge=0)
    options: List[SelectedOption] = Field(default_factory=list)
    # Bundle / Grade-Set support: when True the backend explodes sub-SKUs for
    # stock deduction and records one clean receipt line for the bundle.
    is_bundle: bool = Field(default=False)
    bundle_id: Optional[int] = Field(default=None)


class CheckoutPayload(BaseModel):
    transaction_mode: TransactionMode = TransactionMode.SALE
    payment_method: PaymentMethod = PaymentMethod.CASH
    # `payer_kind` selects the wallet owner when payment hits a wallet:
    #  - "customer": legacy student-wallet flow (customer_id)
    #  - "user":     parent/staff personal wallet (payer_user_id)
    #  - "department": coop department wallet (payer_department_id) — used when
    #     payment_method=department; deducts from the dept wallet (negative-allowed)
    payer_kind: Literal["customer", "user", "department"] = "customer"
    customer_id: Optional[int] = None
    payer_user_id: Optional[int] = None
    payer_department_id: Optional[int] = None
    # Staff requisition: who actually requested the goods (independent of cashier).
    # Optional for SALE; recommended for INTERNAL_ISSUE so consumption is attributed.
    requester_user_id: Optional[int] = None
    items: List[CheckoutItemPayload] = Field(min_length=1)
    # P2.3 — EDC audit fields (required when payment_method=edc)
    edc_terminal_ref: Optional[str] = Field(None, max_length=50)
    edc_approval_code: Optional[str] = Field(None, max_length=20)
    edc_masked_card: Optional[str] = Field(None, max_length=30)
    discount: float = Field(default=0, ge=0, description="Bill-level discount amount")
    notes: Optional[str] = None
    shop_id: Optional[str] = None


# ── Void Request ─────────────────────────────────────────────────────────────

class VoidReceiptRequest(BaseModel):
    reason: Optional[str] = None


# ── Response Models ──────────────────────────────────────────────────────────

class ProductVariantBrief(BaseModel):
    sku: Optional[str] = None
    variant_name: Optional[str] = None
    barcode: Optional[str] = None

    class Config:
        from_attributes = True


class ReceiptItemResponse(BaseModel):
    id: int
    receipt_id: int
    product_variant_id: int
    quantity: int
    unit_price: float
    discount: float
    line_total: float
    options: Optional[Any] = None  # snapshot of selected menu options
    created_at: datetime
    product_variant: Optional[ProductVariantBrief] = None

    class Config:
        from_attributes = True


class PayerDetail(BaseModel):
    name: str
    code: Optional[str] = None
    grade: Optional[str] = None
    photo_url: Optional[str] = None
    role: str
    wallet_balance: Optional[float] = None


class ReceiptResponse(BaseModel):
    id: int
    receipt_number: str
    transaction_date: datetime
    transaction_mode: str
    customer_type_id: Optional[int] = None
    customer_id: Optional[int] = None
    payer_user_id: Optional[int] = None
    payer_department_id: Optional[int] = None
    payer_label: Optional[str] = None  # Display name of the payer (customer/user/department)
    payer_kind: Optional[Literal["customer", "user", "department"]] = None
    payer_detail: Optional[PayerDetail] = None
    requester_user_id: Optional[int] = None
    requester_name: Optional[str] = None
    shop_id: Optional[str] = None
    subtotal: float
    discount: float
    tax: float
    total: float
    payment_method: str
    status: str
    terminal_id: Optional[str] = None
    notes: Optional[str] = None
    edc_terminal_ref: Optional[str] = None
    edc_approval_code: Optional[str] = None
    edc_masked_card: Optional[str] = None
    created_at: datetime
    created_by: int
    created_by_name: Optional[str] = None
    shop_name: Optional[str] = None
    voided_at: Optional[datetime] = None
    voided_by: Optional[int] = None
    voided_reason: Optional[str] = None
    items: List[ReceiptItemResponse] = []

    class Config:
        from_attributes = True
