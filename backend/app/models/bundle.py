"""
Product Bundle / Grade Set Model
Allows selling multiple products as a set while tracking stock by individual items.
"""
from sqlalchemy import Column, Integer, String, Numeric, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class ProductBundle(Base):
    """A bundle/set of products that can be sold together.

    Example: Grade 1 Supplies Set (contains notebook, pencil, eraser, etc.)
    When sold, each item's stock is deducted individually.
    """

    __tablename__ = "product_bundles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    shop_id = Column(String(50), ForeignKey("shops.id", ondelete="CASCADE"), nullable=False, index=True)
    bundle_code = Column(String(50), nullable=False, index=True)  # e.g., "GRADE1-SET"
    name = Column(String(255), nullable=False)  # e.g., "ชุดอุปกรณ์การเรียน Grade 1"
    description = Column(Text, nullable=True)

    # Pricing - bundles can have their own price (typically discounted vs buying items separately)
    external_price = Column(Numeric(10, 2), nullable=False, default=0)  # Retail price for the bundle
    internal_price = Column(Numeric(10, 2), nullable=False, default=0)  # Internal/staff price

    # Optional image and display settings
    photo_url = Column(String(500), nullable=True)
    color = Column(String(50), nullable=True)  # Card background color
    sort_order = Column(Integer, nullable=False, default=0)

    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    shop = relationship("Shop", backref="bundles")
    items = relationship("BundleItem", back_populates="bundle", cascade="all, delete-orphan", order_by="BundleItem.sort_order")

    def __repr__(self):
        return f"<ProductBundle(id={self.id}, code='{self.bundle_code}', name='{self.name}')>"


class BundleItem(Base):
    """An item included in a product bundle.

    Each item specifies a product and quantity that's part of the bundle.
    """

    __tablename__ = "bundle_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    bundle_id = Column(Integer, ForeignKey("product_bundles.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("shop_products.id", ondelete="CASCADE"), nullable=False, index=True)

    # Quantity of this product included in the bundle
    quantity = Column(Integer, nullable=False, default=1)

    # Display order within the bundle
    sort_order = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    bundle = relationship("ProductBundle", back_populates="items")
    product = relationship("ShopProduct")

    def __repr__(self):
        return f"<BundleItem(bundle_id={self.bundle_id}, product_id={self.product_id}, qty={self.quantity})>"
