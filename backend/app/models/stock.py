"""
Stock Level, Inventory Transaction, and Stock Movement Models
"""
from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.core.database import Base


class TransactionType(str, enum.Enum):
    """Transaction types for inventory"""
    SALE = "sale"
    RETURN = "return"
    ADJUSTMENT = "adjustment"
    INTERNAL_ISSUE = "internal_issue"
    INITIAL = "initial"


class StockLevel(Base):
    """Stock level model for tracking inventory quantity"""

    __tablename__ = "stock_levels"

    id = Column(Integer, primary_key=True, index=True)
    product_variant_id = Column(Integer, ForeignKey("product_variants.id", ondelete="CASCADE"), nullable=False, unique=True)
    quantity = Column(Integer, nullable=False, default=0)
    low_stock_threshold = Column(Integer, nullable=False, default=10)
    location = Column(String(100), nullable=True)  # Storage location
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Relationships
    product_variant = relationship("ProductVariant", back_populates="stock_levels")
    updater = relationship("User", foreign_keys=[updated_by])

    def __repr__(self):
        return f"<StockLevel(variant_id={self.product_variant_id}, quantity={self.quantity})>"


class InventoryTransaction(Base):
    """Inventory transaction model for tracking all stock changes"""

    __tablename__ = "inventory_transactions"

    id = Column(Integer, primary_key=True, index=True)
    transaction_type = Column(SQLEnum(TransactionType), nullable=False)
    product_variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=False)
    quantity_change = Column(Integer, nullable=False)  # Can be negative for deductions
    reference_type = Column(String(50), nullable=True)  # e.g., 'receipt', 'return', 'adjustment'
    reference_id = Column(Integer, nullable=True)  # ID of the referenced document
    reason = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Relationships
    creator = relationship("User", foreign_keys=[created_by])

    def __repr__(self):
        return f"<InventoryTransaction(id={self.id}, type='{self.transaction_type}', change={self.quantity_change})>"


class StockMovement(Base):
    """Stock movement model for detailed audit trail of stock changes"""

    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True, index=True)
    product_variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=False)
    quantity_before = Column(Integer, nullable=False)
    quantity_change = Column(Integer, nullable=False)
    quantity_after = Column(Integer, nullable=False)
    movement_type = Column(SQLEnum(TransactionType), nullable=False)
    reference_document = Column(String(100), nullable=True)  # e.g., 'RCT-001', 'RET-001'
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Relationships
    creator = relationship("User", foreign_keys=[created_by])

    def __repr__(self):
        return f"<StockMovement(id={self.id}, variant_id={self.product_variant_id}, {self.quantity_before} → {self.quantity_after})>"
