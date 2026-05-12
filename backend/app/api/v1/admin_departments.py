"""
Admin Department wallet adjustment — wraps WalletService.adjust_balance and
records each tweak in wallet_transactions for the monthly clear-bill workflow.

Lives separate from `/admin/wallet-adjust` so the UX can lean on bigger amounts
+ preset reasons (e.g. "เคลียร์ยอดเดือน X") without confusing student adjusts.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_role
from app.core.database import get_db
from app.models.department import Department
from app.models.user import User
from app.models.wallet import Wallet, WalletTransaction
from app.schemas.wallet import WalletTransactionResponse
from app.services.wallet_service import WalletService

router = APIRouter()


class DepartmentAdjustRequest(BaseModel):
    amount: float = Field(description="Positive = credit, negative = debit (THB)")
    reason: str = Field(min_length=1, max_length=500)
    reference_ticket: Optional[str] = Field(None, max_length=50)


class DepartmentAdjustResponse(BaseModel):
    department_id: int
    wallet_id: int
    new_balance: float
    transaction: WalletTransactionResponse


@router.post(
    "/departments/{department_id}/adjust",
    response_model=DepartmentAdjustResponse,
)
def adjust_department_balance(
    department_id: int,
    payload: DepartmentAdjustRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Admin credits or debits a department wallet (monthly clear-bill flow)."""
    dept = (
        db.query(Department)
        .options(joinedload(Department.wallet))
        .filter(Department.id == department_id)
        .first()
    )
    if not dept:
        raise HTTPException(404, "Department not found")
    wallet = dept.wallet or WalletService.ensure_wallet_for_department(db, dept.id)
    db.flush()
    try:
        tx = WalletService.adjust_balance(
            db,
            wallet_id=wallet.id,
            amount=payload.amount,
            admin_user_id=current_user.id,
            reason=payload.reason,
            reference_ticket=payload.reference_ticket,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    db.refresh(wallet)
    return DepartmentAdjustResponse(
        department_id=dept.id,
        wallet_id=wallet.id,
        new_balance=float(wallet.balance),
        transaction=WalletTransactionResponse(
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
        ),
    )


class DepartmentTransactionsResponse(BaseModel):
    items: List[WalletTransactionResponse]


@router.get(
    "/departments/{department_id}/transactions",
    response_model=DepartmentTransactionsResponse,
)
def list_department_transactions(
    department_id: int,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    dept = (
        db.query(Department)
        .options(joinedload(Department.wallet))
        .filter(Department.id == department_id)
        .first()
    )
    if not dept or not dept.wallet:
        raise HTTPException(404, "Department wallet not found")
    rows = (
        db.query(WalletTransaction)
        .filter(WalletTransaction.wallet_id == dept.wallet.id)
        .order_by(WalletTransaction.created_at.desc())
        .limit(limit)
        .all()
    )
    return DepartmentTransactionsResponse(
        items=[
            WalletTransactionResponse(
                id=t.id,
                wallet_id=t.wallet_id,
                transaction_type=t.transaction_type.value,
                amount=float(t.amount),
                balance_before=float(t.balance_before),
                balance_after=float(t.balance_after),
                reference_type=t.reference_type,
                reference_id=t.reference_id,
                description=t.description,
                created_at=t.created_at,
            )
            for t in rows
        ]
    )
