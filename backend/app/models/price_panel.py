"""
Price Panel Model
Each shop can have multiple named price panels (e.g. ราคาทั่วไป, ราคาพิเศษ).
Each panel stores override prices per product; null = fall back to external_price.
"""
from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class PricePanel(Base):
    __tablename__ = "price_panels"

    id = Column(Integer, primary_key=True, autoincrement=True)
    shop_id = Column(String(50), ForeignKey("shops.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    color = Column(String(50), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    shop = relationship("Shop", backref="price_panels")
    items = relationship("PricePanelItem", back_populates="panel", cascade="all, delete-orphan")


class PricePanelItem(Base):
    __tablename__ = "price_panel_items"
    __table_args__ = (UniqueConstraint("panel_id", "product_id", name="uq_panel_product"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    panel_id = Column(Integer, ForeignKey("price_panels.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("shop_products.id", ondelete="CASCADE"), nullable=False, index=True)
    price = Column(Numeric(10, 2), nullable=True)  # null = use external_price
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    panel = relationship("PricePanel", back_populates="items")
    product = relationship("ShopProduct")
