"""
ParentChildLink Model — links parent User to child Customer (student).
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
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

    # Relationships
    parent = relationship("User", foreign_keys=[parent_user_id])
    child = relationship("Customer", foreign_keys=[child_customer_id])

    def __repr__(self):
        return f"<ParentChildLink(parent={self.parent_user_id}, child={self.child_customer_id}, relation='{self.relation}')>"
