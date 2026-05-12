"""
Department endpoints — list for POS dept-charge dropdown.

Department wallet adjustment lives in `admin_departments.py` (admin-only).
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_role
from app.core.database import get_db
from app.models.department import Department
from app.models.user import User

router = APIRouter()


class DepartmentSummary(BaseModel):
    id: int
    department_code: str
    department_name: str
    is_active: bool
    wallet_id: Optional[int] = None
    wallet_balance: Optional[float] = None


@router.get("/", response_model=List[DepartmentSummary])
def list_departments(
    q: Optional[str] = Query(None),
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("cashier", "manager", "admin")
    ),
):
    """List departments + their wallet summary. Used by POS dept-charge dropdown."""
    query = db.query(Department).options(joinedload(Department.wallet))
    if active_only:
        query = query.filter(Department.is_active == True)  # noqa: E712
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        query = query.filter(
            (Department.department_code.ilike(pattern))
            | (Department.department_name.ilike(pattern))
        )
    rows = query.order_by(Department.department_code).all()
    return [
        DepartmentSummary(
            id=d.id,
            department_code=d.department_code,
            department_name=d.department_name,
            is_active=bool(d.is_active),
            wallet_id=d.wallet.id if d.wallet else None,
            wallet_balance=float(d.wallet.balance) if d.wallet else None,
        )
        for d in rows
    ]
