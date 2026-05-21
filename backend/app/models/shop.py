"""
Shop, ShopProduct, ShopCategory, ShopMovement Models
Mirrors the frontend Product / StockMovement interfaces exactly.
"""
import enum
from sqlalchemy import (
    Column, Integer, String, Numeric, Boolean, Date, DateTime,
    ForeignKey, Enum as SAEnum, JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


# ── Enums ─────────────────────────────────────────────────────────────────────

class ShopType(str, enum.Enum):
    avg_cost = "avg_cost"
    fifo = "fifo"


class MovementType(str, enum.Enum):
    receive = "receive"
    sale = "sale"
    adjustment = "adjustment"
    internal_use = "internal_use"
    void = "void"
    exchange = "exchange"


class OptionSelectionType(str, enum.Enum):
    """How a customer selects from a MenuOptionGroup."""
    single = "single"      # radio — pick exactly one
    multi = "multi"        # checkbox — pick 0..max
    quantity = "quantity"  # +/- counter per option (e.g. extra meatballs x2)


# ── Models ────────────────────────────────────────────────────────────────────

class Shop(Base):
    """Shop / Sub-merchant model."""

    __tablename__ = "shops"

    id = Column(String(50), primary_key=True)          # e.g. "coop", "sports"
    name = Column(String(100), nullable=False)
    shop_type = Column(SAEnum(ShopType), nullable=False, default=ShopType.avg_cost)
    description = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    # Only "coop"-category shops accept department (issue-goods) charges.
    allow_department_charge = Column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # Functional module — drives which frontend POS/admin UI this shop uses.
    #   "canteen" → /canteen/* routes + Canteen.tsx POS + RFID-first flow
    #   "store"   → /store/* routes + Store.tsx POS + retail flow
    module = Column(
        String(20), nullable=False, default="store", server_default="store"
    )
    # Per-shop pricing model. true → product has Retail / Internal prices (store
    # default). false → single "price" field (canteen default). Toggleable so
    # other deployments can flip without code changes.
    uses_dual_pricing = Column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    # Optimistic-concurrency token for product reorder. Increments every time
    # a /products/reorder request succeeds; clients must echo their last-seen
    # version and we 409 on mismatch so concurrent admin/POS edits diff before
    # overwriting each other.
    products_order_version = Column(
        Integer, nullable=False, default=1, server_default="1"
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    products = relationship("ShopProduct", back_populates="shop", cascade="all, delete-orphan")
    categories = relationship("ShopCategory", back_populates="shop", cascade="all, delete-orphan")
    movements = relationship("ShopMovement", back_populates="shop")
    fifo_lots = relationship("FifoLot", back_populates="shop")

    def __repr__(self):
        return f"<Shop(id='{self.id}', name='{self.name}', type={self.shop_type})>"


class ShopCategory(Base):
    """Per-shop product category."""

    __tablename__ = "shop_categories"

    id = Column(String(50), primary_key=True)           # e.g. "cat-1234567890"
    shop_id = Column(String(50), ForeignKey("shops.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    shop = relationship("Shop", back_populates="categories")

    def __repr__(self):
        return f"<ShopCategory(id='{self.id}', shop='{self.shop_id}', name='{self.name}')>"


class ShopProduct(Base):
    """
    Shop-scoped product — maps 1-to-1 with the frontend Product interface.
    Keeps pricing, costing, and stock in a single row per shop.
    """

    __tablename__ = "shop_products"

    id = Column(Integer, primary_key=True, autoincrement=True)
    shop_id = Column(String(50), ForeignKey("shops.id", ondelete="CASCADE"), nullable=False, index=True)
    product_code = Column(String(50), nullable=False)
    barcode = Column(String(100), nullable=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    category = Column(String(100), nullable=False, default="ทั่วไป")
    uom_id = Column(Integer, ForeignKey("units_of_measure.id"), nullable=True)  # Unit of measure
    external_price = Column(Numeric(10, 2), nullable=False, default=0)
    internal_price = Column(Numeric(10, 2), nullable=False, default=0)
    vat_percent = Column(Numeric(5, 2), nullable=False, default=7)
    avg_cost = Column(Numeric(10, 4), nullable=False, default=0)
    stock = Column(Integer, nullable=False, default=0)
    min_stock = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, default=True, nullable=False)
    photo_url = Column(String(500), nullable=True)  # Menu image (upload via /shops/{id}/products/{pid}/photo)
    color = Column(String(50), nullable=True)  # Optional card background color (CSS hex, e.g. #ff5733)
    # Per-shop display order. Drag-and-drop in admin/POS bulk-updates these
    # via /shops/{id}/products/reorder; lower number renders first.
    sort_order = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    shop = relationship("Shop", back_populates="products")
    movements = relationship("ShopMovement", back_populates="product")
    fifo_lots = relationship("FifoLot", back_populates="product", cascade="all, delete-orphan")
    option_groups = relationship(
        "MenuOptionGroup",
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="MenuOptionGroup.sort_order",
    )
    uom = relationship("UnitOfMeasure", foreign_keys=[uom_id])

    def __repr__(self):
        return f"<ShopProduct(id={self.id}, shop='{self.shop_id}', name='{self.name}')>"


class MenuOptionGroup(Base):
    """
    Group of menu customisations attached to a ShopProduct.
    e.g. "ระดับความเผ็ด" (single, required), "เพิ่มเติม" (quantity, optional).
    """

    __tablename__ = "menu_option_groups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(
        Integer, ForeignKey("shop_products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(100), nullable=False)
    selection_type = Column(SAEnum(OptionSelectionType), nullable=False)
    is_required = Column(Boolean, nullable=False, default=False)
    max_selections = Column(Integer, nullable=True)  # null = unlimited (for multi / quantity)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    product = relationship("ShopProduct", back_populates="option_groups")
    options = relationship(
        "MenuOption",
        back_populates="group",
        cascade="all, delete-orphan",
        order_by="MenuOption.sort_order",
    )

    def __repr__(self):
        return f"<MenuOptionGroup(id={self.id}, name='{self.name}', type={self.selection_type})>"


class MenuOption(Base):
    """Single selectable option inside a MenuOptionGroup."""

    __tablename__ = "menu_options"

    id = Column(Integer, primary_key=True, autoincrement=True)
    option_group_id = Column(
        Integer,
        ForeignKey("menu_option_groups.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(100), nullable=False)
    price_delta = Column(Numeric(10, 2), nullable=False, default=0)
    sort_order = Column(Integer, nullable=False, default=0)

    # Relationships
    group = relationship("MenuOptionGroup", back_populates="options")

    def __repr__(self):
        return f"<MenuOption(id={self.id}, name='{self.name}', delta={self.price_delta})>"


class ShopMovement(Base):
    """
    Stock movement audit log per shop product.
    Matches the frontend StockMovement interface.
    """

    __tablename__ = "shop_movements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("shop_products.id", ondelete="SET NULL"), nullable=True, index=True)
    product_name = Column(String(255), nullable=False)   # denormalized for history
    shop_id = Column(String(50), ForeignKey("shops.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(SAEnum(MovementType), nullable=False)
    quantity = Column(Integer, nullable=False)
    stock_before = Column(Integer, nullable=False)
    stock_after = Column(Integer, nullable=False)
    cost_per_unit = Column(Numeric(10, 4), nullable=True)
    reference = Column(String(100), nullable=True)
    note = Column(String(500), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Reversal links — set when this movement is reversed (or is itself a reversal).
    reverses_id = Column(
        Integer,
        ForeignKey("shop_movements.id", ondelete="SET NULL"),
        nullable=True,
    )
    reversed_by_id = Column(
        Integer,
        ForeignKey("shop_movements.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    product = relationship("ShopProduct", back_populates="movements")
    shop = relationship("Shop", back_populates="movements")

    def __repr__(self):
        return f"<ShopMovement(id={self.id}, type={self.type}, qty={self.quantity})>"


class ProductOrderHistory(Base):
    """Audit log for shop_products sort_order changes.

    Each successful /shops/{id}/products/reorder call writes one row with the
    full sort map plus the shop's new version. Used to power the conflict-
    resolution diff view when two clients save concurrent reorders.
    """

    __tablename__ = "product_order_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    shop_id = Column(String(50), ForeignKey("shops.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    sort_map = Column(JSON, nullable=False)
    changed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    changed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    source = Column(String(20), nullable=True)  # 'admin' | 'pos'

    def __repr__(self):
        return f"<ProductOrderHistory(shop={self.shop_id}, v={self.version})>"
