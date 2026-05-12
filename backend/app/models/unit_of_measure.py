"""
Unit of Measure (UOM) Model
Supports different measurement units for products (e.g., pieces, boxes, kg)
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Numeric
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class UnitOfMeasure(Base):
    """Unit of Measure model for product quantity tracking."""

    __tablename__ = "units_of_measure"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(20), unique=True, nullable=False, index=True)  # e.g., "PCS", "BOX", "KG"
    name = Column(String(100), nullable=False)  # e.g., "ชิ้น", "กล่อง", "กิโลกรัม"
    name_en = Column(String(100), nullable=True)  # e.g., "Piece", "Box", "Kilogram"

    # Base unit for conversion (null if this is a base unit)
    # e.g., "BOX" might have base_uom_id pointing to "PCS" with conversion_factor=12
    base_uom_id = Column(Integer, nullable=True)
    conversion_factor = Column(Numeric(10, 4), nullable=False, default=1)  # How many base units in this UOM

    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<UnitOfMeasure(id={self.id}, code='{self.code}', name='{self.name}')>"
