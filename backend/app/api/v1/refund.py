"""
Graduation Refund API Routes
GET  /api/v1/refund/candidates       — list customers eligible for graduation refund
POST /api/v1/refund/{customer_id}    — issue refund from a customer's wallet
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import require_role
from app.models.user import User
from app.schemas.refund import (
    RefundCandidate,
    RefundCreateRequest,
    RefundResponse,
)
from app.services.refund_service import RefundService

router = APIRouter()


@router.get("/candidates", response_model=List[RefundCandidate])
def list_refund_candidates(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "refund_officer")),
):
    """List graduated/withdrawn customers with wallet balance > 0 eligible for refund."""
    return RefundService.list_candidates(db)


@router.post("/{customer_id}", response_model=RefundResponse)
def create_refund(
    customer_id: int,
    payload: RefundCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "refund_officer")),
):
    """Issue a graduation refund from the customer's wallet.

    Raises:
      400 — amount must be positive / insufficient wallet balance / invalid refund method
      404 — customer or wallet not found
      403 — caller lacks admin/refund_officer role (enforced by require_role)
    """
    try:
        return RefundService.create_refund(
            db=db,
            customer_id=customer_id,
            amount=payload.amount,
            method=payload.method,
            notes=payload.notes,
            user_id=current_user.id,
        )
    except LookupError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
