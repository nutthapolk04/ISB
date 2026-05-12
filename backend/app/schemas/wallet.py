"""
Wallet Pydantic Schemas
"""
from typing import Literal, Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


class WalletResponse(BaseModel):
    id: int
    # owner_type tells the UI which entity owns this wallet. Exactly one of
    # customer_id / user_id / department_id is populated.
    owner_type: Literal["customer", "user", "department"] = "customer"
    customer_id: Optional[int] = None
    user_id: Optional[int] = None
    department_id: Optional[int] = None
    balance: float
    is_active: bool
    # Nested owner info — populated based on owner_type. The fields are kept
    # flat so the existing WalletDetail / FamilyDashboard render code can reuse
    # `name`, `photo_url`, etc. without branching.
    name: Optional[str] = None
    photo_url: Optional[str] = None
    # Customer-only fields
    customer_code: Optional[str] = None
    student_code: Optional[str] = None
    grade: Optional[str] = None
    card_frozen: Optional[bool] = None
    daily_limit: Optional[float] = None
    # User-only fields
    username: Optional[str] = None
    role: Optional[str] = None
    # Department-only fields
    department_code: Optional[str] = None


class WalletTransactionResponse(BaseModel):
    id: int
    wallet_id: int
    transaction_type: str
    amount: float
    balance_before: float
    balance_after: float
    reference_type: Optional[str] = None
    reference_id: Optional[int] = None
    description: Optional[str] = None
    shop_id: Optional[str] = None
    shop_name: Optional[str] = None
    created_at: datetime


class AdjustBalanceRequest(BaseModel):
    amount: float = Field(description="Positive = credit, negative = debit (THB)")
    reason: str = Field(min_length=1, max_length=500, description="Why this adjustment is needed — shown in audit log")
    reference_ticket: Optional[str] = Field(None, max_length=50, description="External reference e.g. Linear/Jira/Slack thread")


class SiblingTransferRequest(BaseModel):
    from_wallet_id: int
    to_wallet_id: int
    amount: float = Field(gt=0, description="Amount to transfer (THB)")
    note: Optional[str] = Field(None, max_length=500)


class SiblingTransferResponse(BaseModel):
    debit_tx: WalletTransactionResponse
    credit_tx: WalletTransactionResponse
    from_balance_after: float
    to_balance_after: float


# Generic family-internal transfer (parent↔child, child↔child, child↔parent).
# Same shape as SiblingTransferRequest but kept as a separate name so callers
# don't accidentally use the legacy sibling-only endpoint for non-sibling moves.
FamilyTransferRequest = SiblingTransferRequest
FamilyTransferResponse = SiblingTransferResponse


class TopupRequest(BaseModel):
    amount: float = Field(gt=0, description="Top-up amount in THB")
    notes: Optional[str] = None
    payment_method: str = Field(default="qr_promptpay", description="qr_promptpay | cash | credit_card")


class TopupIntentResponse(BaseModel):
    ref_code: str
    wallet_id: int
    amount: float
    qr_payload: str
    status: str
    payment_method: str
    confirmed_via: Optional[str] = None
    created_at: datetime


