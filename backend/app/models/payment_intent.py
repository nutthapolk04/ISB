"""
PaymentIntent Model — tracks wallet top-up QR codes (mock PromptPay flow).
"""
import enum
from sqlalchemy import Column, Integer, String, Text, Numeric, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class PaymentIntentStatus(str, enum.Enum):
    pending = "pending"
    confirmed = "confirmed"
    cancelled = "cancelled"


class PaymentIntent(Base):
    """Top-up payment intent. Parent generates QR → admin confirms → wallet credited."""

    __tablename__ = "payment_intents"

    id = Column(Integer, primary_key=True, index=True)
    ref_code = Column(String(50), unique=True, nullable=False, index=True)  # e.g. TOP-20260417-001
    wallet_id = Column(Integer, ForeignKey("wallets.id", ondelete="CASCADE"), nullable=False, index=True)
    amount = Column(Numeric(10, 2), nullable=False)
    qr_payload = Column(Text, nullable=True)                 # PromptPay QR data string
    status = Column(SQLEnum(PaymentIntentStatus), default=PaymentIntentStatus.pending, nullable=False)
    payment_method = Column(String(30), nullable=False, default="qr_promptpay")  # qr_promptpay | cash | credit_card
    confirmed_via = Column(String(30), nullable=True)        # admin_manual | parent_self | gateway_webhook
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)
    confirmed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    notes = Column(String(500), nullable=True)

    # Relationships
    wallet = relationship("Wallet")
    creator = relationship("User", foreign_keys=[created_by])
    confirmer = relationship("User", foreign_keys=[confirmed_by])

    def __repr__(self):
        return f"<PaymentIntent(ref='{self.ref_code}', amount={self.amount}, status={self.status})>"
