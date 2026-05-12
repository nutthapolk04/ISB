"""
CreditNote Model
"""
from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.core.database import Base


class RefundType(str, enum.Enum):
    """Refund types"""
    PRODUCT = "product"
    WALLET = "wallet"
    CASH = "cash"


class CreditNoteStatus(str, enum.Enum):
    """Credit note status"""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    COMPLETED = "completed"


class CreditNote(Base):
    """Credit note model for returns and refunds"""

    __tablename__ = "credit_notes"

    id = Column(Integer, primary_key=True, index=True)
    credit_note_number = Column(String(50), unique=True, nullable=False, index=True)
    original_receipt_id = Column(Integer, ForeignKey("receipts.id"), nullable=True)
    credit_date = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    total_credit_amount = Column(Numeric(10, 2), nullable=False)
    refund_type = Column(SQLEnum(RefundType), nullable=False)
    status = Column(SQLEnum(CreditNoteStatus), default=CreditNoteStatus.PENDING, nullable=False)
    reason = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Relationships
    original_receipt = relationship("Receipt", foreign_keys=[original_receipt_id])
    creator = relationship("User", foreign_keys=[created_by])
    approver = relationship("User", foreign_keys=[approved_by])

    def __repr__(self):
        return f"<CreditNote(id={self.id}, number='{self.credit_note_number}', amount={self.total_credit_amount})>"
