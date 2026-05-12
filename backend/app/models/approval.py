"""
ApprovalRequest Model
"""
from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, Enum as SQLEnum, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.core.database import Base


class ApprovalRequestType(str, enum.Enum):
    """Approval request types"""
    BUDGET_OVERRIDE = "budget_override"
    DISCOUNT = "discount"
    RETURN = "return"
    VOID = "void"
    PRICE_OVERRIDE = "price_override"


class ApprovalStatus(str, enum.Enum):
    """Approval status"""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ApprovalRequest(Base):
    """Approval request model for workflow approvals"""

    __tablename__ = "approval_requests"

    id = Column(Integer, primary_key=True, index=True)
    request_type = Column(SQLEnum(ApprovalRequestType), nullable=False)
    requested_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    request_date = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    status = Column(SQLEnum(ApprovalStatus), default=ApprovalStatus.PENDING, nullable=False)
    amount = Column(Numeric(10, 2), nullable=True)
    reason = Column(Text, nullable=True)
    reference_type = Column(String(50), nullable=True)  # e.g., 'receipt', 'internal_issue'
    reference_id = Column(Integer, nullable=True)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approval_date = Column(DateTime(timezone=True), nullable=True)
    approval_notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    requester = relationship("User", foreign_keys=[requested_by])
    approver = relationship("User", foreign_keys=[approved_by])

    def __repr__(self):
        return f"<ApprovalRequest(id={self.id}, type='{self.request_type}', status='{self.status}')>"
