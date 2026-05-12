"""
FamilyProfile — family-level metadata synced from PowerSchool (Phase 3.5b).

One row per `family_code`. Holds fields that don't belong to a single
user/customer: notification emails (parent contact addresses, often
distinct from login IDs) and the list of login IDs that PS associates
with the family.
"""
from sqlalchemy import Column, String, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.core.database import Base


class FamilyProfile(Base):
    __tablename__ = "family_profiles"

    family_code = Column(String(20), primary_key=True)
    notification_emails = Column(JSONB, nullable=False, default=list, server_default="[]")
    login_ids = Column(JSONB, nullable=False, default=list, server_default="[]")
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<FamilyProfile(family_code='{self.family_code}')>"
