"""
FifoLot Model
Tracks individual cost lots for FIFO-type shops.
Phantom lots (qty_remaining < 0) represent negative stock overshoot.
"""
from sqlalchemy import Column, Integer, String, Numeric, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class FifoLot(Base):
    """
    A single FIFO cost lot for a shop product.
    - qty_remaining may be negative (phantom lot) when stock goes below zero.
    - cost_per_unit of the phantom lot = latest real lot cost (COGS fallback).
    """

    __tablename__ = "fifo_lots"

    id = Column(String(100), primary_key=True)           # e.g. "recv-1234", "adj-1234", "phantom-1234"
    product_id = Column(Integer, ForeignKey("shop_products.id", ondelete="CASCADE"), nullable=False, index=True)
    shop_id = Column(String(50), ForeignKey("shops.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(Date, nullable=False)
    qty_remaining = Column(Numeric(10, 4), nullable=False, default=0)
    cost_per_unit = Column(Numeric(10, 4), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    product = relationship("ShopProduct", back_populates="fifo_lots")
    shop = relationship("Shop", back_populates="fifo_lots")

    def __repr__(self):
        return f"<FifoLot(id='{self.id}', product={self.product_id}, qty={self.qty_remaining}, cost={self.cost_per_unit})>"
