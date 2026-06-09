"""
ParentChildLink Model — links parent User to child Customer (student).
"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


class ParentChildLink(Base):
    """Association between a parent (User) and their child (Customer/Student)."""

    __tablename__ = "parent_child_links"
    __table_args__ = (
        UniqueConstraint("parent_user_id", "child_customer_id", name="uq_parent_child"),
    )

    id = Column(Integer, primary_key=True, index=True)
    parent_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    child_customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)
    relation = Column(String(20), nullable=False, default="guardian")  # father | mother | guardian
    parent_rank = Column(String(10), nullable=True)  # "main" | "secondary" | null (PS hierarchy; null for manual links)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Low-balance email alert preferences — per parent/child pair so a mum and
    # dad can each set their own threshold. last_low_balance_alert_at gives us
    # the hysteresis anchor: only re-fire after the balance has climbed back
    # above the threshold and crossed downward again.
    low_balance_threshold = Column(Numeric(10, 2), nullable=True)
    low_balance_alert_enabled = Column(Boolean, nullable=False, default=False, server_default="false")
    last_low_balance_alert_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    parent = relationship("User", foreign_keys=[parent_user_id])
    child = relationship("Customer", foreign_keys=[child_customer_id])

    def __repr__(self):
        return f"<ParentChildLink(parent={self.parent_user_id}, child={self.child_customer_id}, relation='{self.relation}')>"
