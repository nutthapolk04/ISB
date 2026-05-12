"""
Department and BudgetTransaction Models
"""
from sqlalchemy import Column, Integer, String, Numeric, Boolean, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.core.database import Base


class BudgetTransactionType(str, enum.Enum):
    """Budget transaction types"""
    ALLOCATION = "allocation"
    DEDUCTION = "deduction"
    ADJUSTMENT = "adjustment"


class Department(Base):
    """Department model for budget control"""

    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True)
    department_code = Column(String(50), unique=True, nullable=False, index=True)
    department_name = Column(String(255), nullable=False)
    annual_budget = Column(Numeric(12, 2), nullable=False, default=0.00)
    current_year = Column(Integer, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    customers = relationship("Customer", back_populates="department")
    budget_transactions = relationship("BudgetTransaction", back_populates="department", cascade="all, delete-orphan")
    wallet = relationship(
        "Wallet",
        back_populates="department",
        uselist=False,
        foreign_keys="Wallet.department_id",
    )

    def __repr__(self):
        return f"<Department(id={self.id}, code='{self.department_code}', name='{self.department_name}')>"


class BudgetTransaction(Base):
    """Budget transaction model for tracking department budget usage"""

    __tablename__ = "budget_transactions"

    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="CASCADE"), nullable=False)
    transaction_date = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    transaction_type = Column(SQLEnum(BudgetTransactionType), nullable=False)
    reference_type = Column(String(50), nullable=True)  # e.g., 'internal_issue'
    reference_id = Column(Integer, nullable=True)
    description = Column(String(500), nullable=True)
    balance_before = Column(Numeric(12, 2), nullable=False)
    balance_after = Column(Numeric(12, 2), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Relationships
    department = relationship("Department", back_populates="budget_transactions")
    creator = relationship("User", foreign_keys=[created_by])

    def __repr__(self):
        return f"<BudgetTransaction(id={self.id}, dept_id={self.department_id}, amount={self.amount})>"
