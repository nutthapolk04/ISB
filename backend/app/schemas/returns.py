"""
Returns & Exchange Schemas
"""
from typing import Optional, List
from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum


# ── Enums ────────────────────────────────────────────────────────────────────

class ReturnStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ReturnItemStatus(str, Enum):
    NO_RETURN = "no-return"
    PARTIAL_RETURN = "partial-return"
    FULL_RETURN = "full-return"


class PriceType(str, Enum):
    INTERNAL = "internal"
    NORMAL = "normal"


class RefundMethod(str, Enum):
    CASH = "cash"
    CARD = "card"


# ── Create Return Request ────────────────────────────────────────────────────

class ReturnItemPayload(BaseModel):
    productCode: str
    productName: str
    quantity: int = Field(ge=1)
    returnQuantity: int = Field(ge=1)
    price: float = Field(ge=0)


class CreateReturnRequest(BaseModel):
    receiptId: str
    items: List[ReturnItemPayload] = Field(min_length=1)
    reason: str = Field(min_length=1)


class ReturnWithoutReceiptItemPayload(BaseModel):
    """Item payload for returns without a receipt - requires product lookup by barcode/code."""
    productCode: str
    productName: str
    returnQuantity: int = Field(ge=1)
    unitPrice: float = Field(ge=0)
    shopId: str


class CreateReturnWithoutReceiptRequest(BaseModel):
    """Create a return without linking to a specific receipt."""
    items: List[ReturnWithoutReceiptItemPayload] = Field(min_length=1)
    reason: str = Field(min_length=1)
    customerName: Optional[str] = None  # Optional customer info for record-keeping
    notes: Optional[str] = None


# ── Update Return Request ───────────────────────────────────────────────────

class UpdateReturnRequest(BaseModel):
    productName: Optional[str] = None
    quantity: Optional[int] = None
    returnQuantity: Optional[int] = None
    reason: Optional[str] = None
    status: Optional[ReturnStatus] = None
    priceType: Optional[PriceType] = None


# ── Refund Request ───────────────────────────────────────────────────────────

class RefundItemPayload(BaseModel):
    productCode: str
    returnQuantity: int = Field(ge=1)


class ExchangeItemPayload(BaseModel):
    productCode: str
    quantity: int = Field(ge=1)


class ProcessRefundRequest(BaseModel):
    returnItems: List[RefundItemPayload] = Field(min_length=1)
    exchangeItems: Optional[List[ExchangeItemPayload]] = None
    refundMethod: RefundMethod
    reason: str
    notes: Optional[str] = None


# ── Exchange Request ─────────────────────────────────────────────────────────

class ProcessExchangeRequest(BaseModel):
    returnItems: List[RefundItemPayload] = Field(min_length=1)
    exchangeItems: List[ExchangeItemPayload] = Field(min_length=1)
    difference: float = 0.0
    reason: str
    notes: Optional[str] = None


# ── Response Models ──────────────────────────────────────────────────────────

class ReturnRequestResponse(BaseModel):
    id: int
    receiptId: str
    productCode: Optional[str] = None
    productName: str
    quantity: int
    returnQuantity: int
    reason: str
    status: str
    date: str
    priceType: str
    voidStatus: Optional[str] = "active"
    returnStatus: Optional[str] = "no-return"


class ReturnHistoryResponse(BaseModel):
    id: str
    date: str
    receiptId: str
    studentId: Optional[str] = ""
    studentName: Optional[str] = ""
    returnedItems: List[str] = []
    exchangedItems: List[str] = []
    returnValue: float = 0.0
    exchangeValue: float = 0.0
    difference: float = 0.0
    status: str
    reason: str


class RefundResponse(BaseModel):
    id: str
    refundAmount: float
    refundMethod: str
    status: str
    timestamp: str


class ExchangeResponse(BaseModel):
    id: str
    returnValue: float
    exchangeValue: float
    difference: float
    status: str
    timestamp: str
