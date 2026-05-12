"""
SyncLog — audit record for PowerSchool sync runs (manual triggers).
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.core.database import Base


class SyncLog(Base):
    __tablename__ = "sync_logs"

    id = Column(Integer, primary_key=True, index=True)
    sync_type = Column(String(20), nullable=False)           # 'delta' | 'full'
    target_roles = Column(JSONB, nullable=False)             # e.g. ["student","parent"]
    triggered_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(20), nullable=False, default="running")  # running | success | partial | failed
    records_total = Column(Integer, default=0, nullable=False)
    records_success = Column(Integer, default=0, nullable=False)
    records_failed = Column(Integer, default=0, nullable=False)
    error_log = Column(Text, nullable=True)

    def __repr__(self):
        return f"<SyncLog(id={self.id}, type={self.sync_type}, status={self.status})>"
