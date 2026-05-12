"""
Department service — create + list with wallet semantics.

Departments are cardholder-like ledger entities: a Department row owns a
department-keyed Wallet that allows negative balances (monthly credit-line
cleared offline). Wallet is debited at coop POS via payment_method=department
and topped up / cleared via /admin/department-adjust.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.models.department import Department
from app.models.wallet import Wallet


class DepartmentService:
    @staticmethod
    def create_department(
        db: Session,
        *,
        code: str,
        name: str,
        annual_budget: float = 0,
        initial_credit: float = 0,
    ) -> Department:
        """Create a Department + its wallet (department-keyed) in one transaction."""
        existing = db.query(Department).filter(Department.department_code == code).first()
        if existing:
            raise ValueError(f"Department code '{code}' already exists")
        dept = Department(
            department_code=code,
            department_name=name,
            annual_budget=annual_budget,
            current_year=datetime.utcnow().year,
            is_active=True,
        )
        db.add(dept)
        db.flush()
        wallet = Wallet(department_id=dept.id, balance=initial_credit, is_active=True)
        db.add(wallet)
        db.commit()
        db.refresh(dept)
        return dept

    @staticmethod
    def list_departments(
        db: Session,
        *,
        q: Optional[str] = None,
        active_only: bool = True,
        page: int = 1,
        page_size: int = 100,
    ) -> Tuple[List[Department], int]:
        query = db.query(Department).options(joinedload(Department.wallet))
        if active_only:
            query = query.filter(Department.is_active == True)  # noqa: E712
        if q:
            pattern = f"%{q.strip()}%"
            query = query.filter(
                or_(
                    Department.department_code.ilike(pattern),
                    Department.department_name.ilike(pattern),
                )
            )
        total = query.count()
        page = max(1, int(page or 1))
        page_size = max(1, min(500, int(page_size or 100)))
        rows = (
            query.order_by(Department.department_code)
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return rows, total

    @staticmethod
    def get_department(db: Session, department_id: int) -> Optional[Department]:
        return (
            db.query(Department)
            .options(joinedload(Department.wallet))
            .filter(Department.id == department_id)
            .first()
        )
