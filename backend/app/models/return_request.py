"""
ReturnRequest Model — tracks individual return/exchange line items.
"""
import enum
from sqlalchemy import Column, Integer, String, Numeric, DateTime, Enum as SQLEnum
from sqlalchemy.sql import func
from app.core.database import Base


class ReturnStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class ReturnRequest(Base):
    """One row per returned product line."""

    __tablename__ = "return_requests"

    id = Column(Integer, primary_key=True, index=True)
    receipt_id = Column(String(50), nullable=False, index=True)  # receipt_number
    product_code = Column(String(50), nullable=False)
    product_name = Column(String(255), nullable=False)
    # When the returned line was sold as a bundle, this points to the source
    # ProductBundle so _restore_stock can loop back every sub-SKU that was
    # deducted at checkout. NULL for regular (non-bundle) lines.
    bundle_id = Column(Integer, nullable=True, index=True)
    quantity = Column(Integer, nullable=False)          # original qty
    return_quantity = Column(Integer, nullable=False)   # qty being returned
    price = Column(Numeric(10, 2), nullable=False, default=0)
    reason = Column(String(500), nullable=False)
    status = Column(SQLEnum(ReturnStatus), default=ReturnStatus.pending, nullable=False)
    price_type = Column(String(20), default="normal")   # "internal" | "normal"
    void_status = Column(String(20), default="active")   # "active" | "voided"
    return_status = Column(String(20), default="no-return")  # "no-return" | "partial-return" | "full-return"
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by = Column(Integer, nullable=True)

    # exchange / refund tracking
    refund_method = Column(String(20), nullable=True)    # "cash" | "card"
    exchange_product_codes = Column(String(500), nullable=True)  # comma-separated
    refund_amount = Column(Numeric(10, 2), nullable=True)
    exchange_amount = Column(Numeric(10, 2), nullable=True)
    processed_at = Column(DateTime(timezone=True), nullable=True)

    def __repr__(self):
        return f"<ReturnRequest(id={self.id}, receipt='{self.receipt_id}', status={self.status})>"
