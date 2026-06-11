"""
Receipt and ReceiptItem Models
"""
from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, Enum as SQLEnum, Text, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.core.database import Base


class TransactionMode(str, enum.Enum):
    """Transaction modes"""
    SALE = "sale"
    INTERNAL_ISSUE = "internal_issue"


class ReceiptStatus(str, enum.Enum):
    """Receipt status"""
    ACTIVE = "active"
    VOIDED = "voided"


class PaymentMethod(str, enum.Enum):
    """Payment methods"""
    CASH = "cash"
    CREDIT_CARD = "credit_card"
    DEBIT_CARD = "debit_card"
    WALLET = "wallet"
    BANK_TRANSFER = "bank_transfer"
    CARD_TAP = "card_tap"           # MIFARE / NFC smart card tap → charges wallet
    EDC = "edc"                     # External card terminal (credit/debit via EDC device)
    DEPARTMENT = "department"       # Staff issue-goods charged to department budget (coop only)
    OTHER = "other"


class Receipt(Base):
    """Receipt model for sales and internal issue transactions"""

    __tablename__ = "receipts"

    id = Column(Integer, primary_key=True, index=True)
    receipt_number = Column(String(50), unique=True, nullable=False, index=True)
    transaction_date = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    transaction_mode = Column(SQLEnum(TransactionMode), nullable=False)
    customer_type_id = Column(Integer, ForeignKey("customer_types.id"), nullable=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    # Polymorphic payer reference — at most one of customer_id / payer_user_id /
    # payer_department_id is set per receipt. customer_id covers students/visitors,
    # payer_user_id covers parent/staff personal wallets, payer_department_id
    # covers coop department budgets debited via payment_method=department.
    payer_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    payer_department_id = Column(Integer, ForeignKey("departments.id"), nullable=True, index=True)
    # Staff requisition: who actually requested the goods (independent of cashier
    # in created_by). Used for internal_issue receipts to attribute consumption.
    requester_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    shop_id = Column(String(50), ForeignKey("shops.id"), nullable=True, index=True)  # Phase 3: which shop this sale occurred at
    subtotal = Column(Numeric(10, 2), nullable=False, default=0.00)
    discount = Column(Numeric(10, 2), nullable=False, default=0.00)
    tax = Column(Numeric(10, 2), nullable=False, default=0.00)
    total = Column(Numeric(10, 2), nullable=False)
    payment_method = Column(SQLEnum(PaymentMethod), nullable=False)
    status = Column(SQLEnum(ReceiptStatus), default=ReceiptStatus.ACTIVE, nullable=False)
    terminal_id = Column(String(50), nullable=True)
    notes = Column(Text, nullable=True)
    # P2.3 — EDC (credit/debit card terminal) audit fields
    edc_terminal_ref = Column(String(50), nullable=True)
    edc_approval_code = Column(String(20), nullable=True)
    edc_masked_card = Column(String(30), nullable=True)
    # Cash tendered for cash-payment receipts. NULL for non-cash methods.
    cash_received = Column(Numeric(10, 2), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    voided_at = Column(DateTime(timezone=True), nullable=True)
    voided_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    voided_reason = Column(String(500), nullable=True)
    # Snapshot of the shop's spending_group_id at checkout time.
    # Frozen so that re-grouping a shop mid-day doesn't re-attribute old receipts.
    spending_group_id = Column(
        Integer, ForeignKey("spending_groups.id", ondelete="RESTRICT"), nullable=True, index=True
    )

    # Relationships
    customer = relationship("Customer", back_populates="receipts")
    shop = relationship("Shop", foreign_keys=[shop_id])
    spending_group = relationship("SpendingGroup")
    creator = relationship("User", foreign_keys=[created_by])
    voider = relationship("User", foreign_keys=[voided_by])
    payer_user = relationship("User", foreign_keys=[payer_user_id])
    payer_department = relationship("Department", foreign_keys=[payer_department_id])
    requester = relationship("User", foreign_keys=[requester_user_id])
    items = relationship("ReceiptItem", back_populates="receipt", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Receipt(id={self.id}, number='{self.receipt_number}', total={self.total})>"


class ReceiptItem(Base):
    """Receipt item model for individual line items in a receipt"""

    __tablename__ = "receipt_items"

    id = Column(Integer, primary_key=True, index=True)
    receipt_id = Column(Integer, ForeignKey("receipts.id", ondelete="CASCADE"), nullable=False)
    product_variant_id = Column(Integer, ForeignKey("shop_products.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Numeric(10, 2), nullable=False)
    # One-time POS price override (cashier-entered). When set, the line was
    # billed at this value instead of `unit_price`. NULL = no override.
    price_override = Column(Numeric(10, 2), nullable=True)
    discount = Column(Numeric(10, 2), nullable=False, default=0.00)
    line_total = Column(Numeric(10, 2), nullable=False)
    # Menu customisations snapshot — JSON {"groups": [...], "options_total": float}
    # Stored denormalised so receipt rendering survives MenuOption edits/deletes.
    options = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    receipt = relationship("Receipt", back_populates="items")
    product_variant = relationship("ShopProduct")

    def __repr__(self):
        return f"<ReceiptItem(id={self.id}, receipt_id={self.receipt_id}, quantity={self.quantity})>"
