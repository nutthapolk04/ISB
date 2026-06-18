"""
Customer and CustomerType Models
"""
from sqlalchemy import Column, Integer, String, Text, Boolean, Numeric, Date, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.core.database import Base


class CustomerTypeEnum(str, enum.Enum):
    """Customer types"""
    PUBLIC = "public"
    INTERNAL = "internal"


class CustomerType(Base):
    """Customer type model"""

    __tablename__ = "customer_types"

    id = Column(Integer, primary_key=True, index=True)
    type_name = Column(SQLEnum(CustomerTypeEnum), unique=True, nullable=False)
    description = Column(String(255), nullable=True)
    default_price_level = Column(String(50), nullable=False)  # 'cost' or 'retail'
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    customers = relationship("Customer", back_populates="type_info")

    def __repr__(self):
        return f"<CustomerType(id={self.id}, type='{self.type_name}')>"


class Customer(Base):
    """Customer model"""

    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    customer_code = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    photo_url = Column(String(500), nullable=True)
    customer_type_id = Column(Integer, ForeignKey("customer_types.id"), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    # Student-specific fields (Phase 2 — Parent/Student portal)
    student_code = Column(String(20), unique=True, nullable=True, index=True)
    grade = Column(String(20), nullable=True)
    allergies = Column(Text, nullable=True)           # comma-separated or free text
    dietary_notes = Column(Text, nullable=True)
    card_uid = Column(String(50), unique=True, nullable=True, index=True)
    card_frozen = Column(Boolean, default=False, nullable=False)
    daily_limit = Column(Numeric(10, 2), nullable=True)
    daily_limit_canteen = Column(Numeric(10, 2), nullable=True)
    daily_limit_store = Column(Numeric(10, 2), nullable=True)
    negative_credit_limit = Column(Numeric(10, 2), nullable=True)  # Phase 3: allow overdraft up to this amount
    allergy_override_note = Column(Text, nullable=True)             # Phase 3: admin-added safety note (distinct from PowerSchool-synced allergies)
    powerschool_sync_at = Column(DateTime(timezone=True), nullable=True)
    # Phase 3.5 — PowerSchool integration
    family_code = Column(String(20), nullable=True, index=True)     # Permanent family group (pairs with users.family_code)
    external_id = Column(String(50), nullable=True, index=True)     # PowerSchool student ID (mutable)
    # Phase 3.5b — PowerSchool payload fidelity
    customer_type = Column(String(20), nullable=True)               # "Student" (PS enum — distinct from customer_type_id FK)
    school_type = Column(String(20), nullable=True)                 # "ES Student" | "MS Student" | "HS Student"
    # Unified cardholder taxonomy (admin UI). One of: student | department | other.
    # Parent/Staff are User entities, not Customer rows. Existing customer_type
    # string stays as a PS-side hint and isn't repurposed.
    customer_kind = Column(String(20), nullable=False, server_default="other", index=True)
    is_graduated = Column(Boolean, default=False, nullable=False, server_default="false")
    enroll_date = Column(Date, nullable=True)
    withdraw_date = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    type_info = relationship("CustomerType", back_populates="customers")
    department = relationship("Department", back_populates="customers")
    wallet = relationship("Wallet", back_populates="customer", uselist=False, cascade="all, delete-orphan")
    receipts = relationship("Receipt", back_populates="customer")

    def __repr__(self):
        return f"<Customer(id={self.id}, code='{self.customer_code}', name='{self.name}')>"
