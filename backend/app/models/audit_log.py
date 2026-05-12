"""
AuditLog Model
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum as SQLEnum, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.core.database import Base


class AuditAction(str, enum.Enum):
    """Audit actions"""
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    RETURN = "return"
    EXCHANGE = "exchange"
    CANCEL = "cancel"
    VOID = "void"
    REPRINT = "reprint"
    APPROVE = "approve"
    REJECT = "reject"


class AuditLog(Base):
    """Audit log model for tracking all critical system operations"""

    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(50), nullable=False, index=True)  # e.g., 'receipt', 'return', 'user'
    entity_id = Column(Integer, nullable=True, index=True)
    action = Column(SQLEnum(AuditAction), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    changes_json = Column(JSON, nullable=True)  # JSON of what changed
    ip_address = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    extra_metadata = Column("metadata", JSON, nullable=True)  # Additional metadata

    # Relationships
    user = relationship("User", foreign_keys=[user_id])

    def __repr__(self):
        return f"<AuditLog(id={self.id}, entity='{self.entity_type}', action='{self.action}')>"
