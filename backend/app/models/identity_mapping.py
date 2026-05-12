"""
IdentityMapping — records every change to external_id (PowerSchool ID)
so historical wallet/receipt data stays linkable even if PS renumbers a student.
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.core.database import Base


class IdentityMapping(Base):
    __tablename__ = "identity_mappings"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(20), nullable=False)   # 'user' | 'customer'
    entity_id = Column(Integer, nullable=False)        # references users.id or customers.id
    old_external_id = Column(String(50), nullable=True)
    new_external_id = Column(String(50), nullable=True)
    reason = Column(String(200), nullable=True)
    changed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    changed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    def __repr__(self):
        return f"<IdentityMapping({self.entity_type}#{self.entity_id}: {self.old_external_id} → {self.new_external_id})>"
