"""
SpendingGroup Model

A Spending Group bundles one or more Shops under a shared daily spending
allowance. The daily limit is applied per-group, per-payer, per-calendar-day
(Asia/Bangkok midnight boundary).

is_active = True  → enforce the daily limit
is_active = False → skip enforcement entirely (allow all sales)
"""
from sqlalchemy import Column, Integer, String, Numeric, Boolean, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class SpendingGroup(Base):
    """Shared daily spending limit for a logical group of shops."""

    __tablename__ = "spending_groups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Unique snake_case identifier — e.g. "canteen", "store", "uniforms"
    code = Column(String(40), unique=True, nullable=False, index=True)
    name_en = Column(String(100), nullable=False)
    name_th = Column(String(100), nullable=False)
    # Daily allowance in THB. DB CHECK ensures > 0.
    daily_limit = Column(Numeric(10, 2), nullable=False)
    # True = enforce limit; False = skip check entirely (per decision #4)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Back-reference to shops in this group (read-only in service layer)
    shops = relationship("Shop", back_populates="spending_group")

    def __repr__(self) -> str:
        return f"<SpendingGroup(id={self.id}, code='{self.code}', limit={self.daily_limit})>"
