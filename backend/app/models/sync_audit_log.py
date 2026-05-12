"""
SyncAuditLog — per-record diff captured during a PowerSchool sync run.

The aggregate `SyncLog` row stores totals/status; this table captures *what
changed* per record so admins can answer "what did this sync do to which
person?" without re-reading the fixture/API payload.
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class SyncAuditLog(Base):
    """One row per (synced record, mutated field-set)."""

    __tablename__ = "sync_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    sync_log_id = Column(
        Integer,
        ForeignKey("sync_logs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    entity_type = Column(String(20), nullable=False)  # 'user' | 'customer'
    entity_id = Column(Integer, nullable=False)
    entity_name = Column(String(255), nullable=True)  # snapshot for display
    external_id = Column(String(50), nullable=True)
    action = Column(String(20), nullable=False)        # 'create' | 'update' | 'noop'
    changes = Column(JSON, nullable=True)              # {field: {old, new}, ...}
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    sync_log = relationship("SyncLog", foreign_keys=[sync_log_id])

    def __repr__(self):
        return (
            f"<SyncAuditLog(id={self.id}, sync_log_id={self.sync_log_id}, "
            f"{self.entity_type}#{self.entity_id} {self.action})>"
        )
