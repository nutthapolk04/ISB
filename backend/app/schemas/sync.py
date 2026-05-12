"""
Pydantic schemas for PowerSchool sync (Phase 3.5).
"""
from typing import List, Optional, Literal
from datetime import datetime, date
from pydantic import BaseModel, Field


class SyncRequest(BaseModel):
    sync_type: Literal["delta", "full"] = "delta"
    target_roles: List[str] = Field(default_factory=lambda: ["student", "parent", "staff"])


class SyncResponse(BaseModel):
    sync_log_id: int
    status: str
    sync_type: str
    target_roles: List[str]
    records_total: int
    records_success: int
    records_failed: int
    started_at: datetime
    finished_at: Optional[datetime] = None
    error_log: Optional[str] = None


class SyncLogItem(BaseModel):
    id: int
    sync_type: str
    target_roles: List[str]
    triggered_by_name: Optional[str] = None
    started_at: datetime
    finished_at: Optional[datetime] = None
    status: str
    records_total: int
    records_success: int
    records_failed: int
    error_log: Optional[str] = None

    class Config:
        from_attributes = True


class DailyBucket(BaseModel):
    date: date
    success: int
    failed: int


class SyncStats(BaseModel):
    total_runs: int
    total_success: int
    total_failed: int
    last_sync_at: Optional[datetime] = None
    last_sync_status: Optional[str] = None
    daily: List[DailyBucket] = []
