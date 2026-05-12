"""
Wallet and WalletTransaction Models
"""
from sqlalchemy import (
    Column,
    Integer,
    String,
    Numeric,
    Boolean,
    DateTime,
    ForeignKey,
    CheckConstraint,
    Enum as SQLEnum,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.core.database import Base


class WalletTransactionType(str, enum.Enum):
    """Wallet transaction types"""
    TOPUP = "topup"
    DEDUCTION = "deduction"
    REFUND = "refund"
    ADJUSTMENT = "adjustment"


class Wallet(Base):
    """Prepaid balance for one of {Customer, User, Department}.

    Exactly one of `customer_id` / `user_id` / `department_id` is set per row —
    see `chk_wallet_owner`. Keying staff/parent wallets by `user_id` lets the
    wallet survive role transitions (parent ↔ staff ↔ admin) since `users.id`
    is stable. Department wallets allow negative balance (monthly credit-line)
    and are debited at coop POS via payment_method=department.
    """

    __tablename__ = "wallets"
    __table_args__ = (
        CheckConstraint(
            "(customer_id IS NOT NULL)::int + "
            "(user_id IS NOT NULL)::int + "
            "(department_id IS NOT NULL)::int = 1",
            name="chk_wallet_owner",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), unique=True, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), unique=True, nullable=True, index=True)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), unique=True, nullable=True, index=True)
    balance = Column(Numeric(10, 2), nullable=False, default=0.00)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    customer = relationship("Customer", back_populates="wallet")
    user = relationship("User", back_populates="wallet", foreign_keys=[user_id])
    department = relationship("Department", back_populates="wallet", foreign_keys=[department_id])
    transactions = relationship("WalletTransaction", back_populates="wallet", cascade="all, delete-orphan")

    def __repr__(self):
        if self.customer_id:
            owner = f"customer_id={self.customer_id}"
        elif self.user_id:
            owner = f"user_id={self.user_id}"
        else:
            owner = f"department_id={self.department_id}"
        return f"<Wallet(id={self.id}, {owner}, balance={self.balance})>"


class WalletTransaction(Base):
    """Wallet transaction model for tracking all wallet activity"""

    __tablename__ = "wallet_transactions"

    id = Column(Integer, primary_key=True, index=True)
    wallet_id = Column(Integer, ForeignKey("wallets.id", ondelete="CASCADE"), nullable=False)
    transaction_type = Column(SQLEnum(WalletTransactionType), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    balance_before = Column(Numeric(10, 2), nullable=False)
    balance_after = Column(Numeric(10, 2), nullable=False)
    reference_type = Column(String(50), nullable=True)  # e.g., 'receipt', 'credit_note', 'topup'
    reference_id = Column(Integer, nullable=True)
    description = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Relationships
    wallet = relationship("Wallet", back_populates="transactions")
    creator = relationship("User", foreign_keys=[created_by])

    def __repr__(self):
        return f"<WalletTransaction(id={self.id}, type='{self.transaction_type}', amount={self.amount})>"
