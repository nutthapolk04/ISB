"""
Graduation Refund Pydantic Schemas
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


RefundMethod = Literal["CASH", "BANK_TRANSFER", "CHEQUE"]


class RefundCandidate(BaseModel):
    """A customer eligible for graduation refund (wallet balance > 0)."""
    id: int
    name: str
    student_code: Optional[str] = None
    family_code: Optional[str] = None
    is_graduated: bool
    wallet_id: int
    wallet_balance: Decimal
    enroll_date: Optional[date] = None
    withdraw_date: Optional[date] = None

    model_config = ConfigDict(from_attributes=True)


class RefundCreateRequest(BaseModel):
    """Request body for POST /refund/{customer_id}."""
    amount: Decimal = Field(..., gt=0, description="Refund amount in THB, must be positive")
    method: RefundMethod
    notes: Optional[str] = Field(None, max_length=500)


class RefundResponse(BaseModel):
    """Response after issuing a refund."""
    transaction_id: int
    customer_id: int
    wallet_id: int
    amount: Decimal
    refund_method: RefundMethod
    balance_before: Decimal
    balance_after: Decimal
    reason: Literal["graduation_refund"] = "graduation_refund"
    notes: Optional[str] = None
    created_at: datetime
    created_by_user_id: int

    model_config = ConfigDict(from_attributes=True)
