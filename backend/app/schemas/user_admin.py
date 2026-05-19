"""
Pydantic schemas for User Management Module (Phase 3.5 + 3.5b PS alignment).
"""
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


class UserListItem(BaseModel):
    id: int
    username: str
    email: str
    full_name: str
    role: Optional[str] = None
    external_id: Optional[str] = None
    family_code: Optional[str] = None
    photo_url: Optional[str] = None
    status: str = "active"
    is_active: bool = True
    last_synced_at: Optional[datetime] = None
    allergies: Optional[str] = None
    # Phase 3.5b
    customer_type: Optional[str] = None   # "Staff" | "Parent" | None
    staff_type: Optional[str] = None      # "Classified Staff" | "Certified Staff"
    ps_department: Optional[str] = None
    card_uid: Optional[str] = None
    has_children: bool = False
    # Shop assignment (multi-canteen)
    shop_id: Optional[str] = None
    shop_name: Optional[str] = None

    class Config:
        from_attributes = True


class FamilyMember(BaseModel):
    """One member of a family_code group — either a user or a student."""
    entity_type: str  # 'user' | 'customer'
    id: int
    name: str
    role: Optional[str] = None        # user role OR 'student'
    external_id: Optional[str] = None
    grade: Optional[str] = None       # students only
    photo_url: Optional[str] = None
    student_code: Optional[str] = None
    customer_code: Optional[str] = None
    # Phase 3.5b
    customer_type: Optional[str] = None   # "Staff" | "Parent" | "Student"
    school_type: Optional[str] = None     # "ES/MS/HS Student"
    card_uid: Optional[str] = None
    parent_rank: Optional[str] = None     # "main" | "secondary" (users only, when link exists)


class FamilyProfileItem(BaseModel):
    family_code: str
    notification_emails: List[str] = []
    login_ids: List[str] = []
    last_synced_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class FamilyProfileUpdate(BaseModel):
    notification_emails: Optional[List[str]] = None
    login_ids: Optional[List[str]] = None


class IdentityHistoryItem(BaseModel):
    id: int
    entity_type: str
    old_external_id: Optional[str] = None
    new_external_id: Optional[str] = None
    reason: Optional[str] = None
    changed_by_name: Optional[str] = None
    changed_at: datetime

    class Config:
        from_attributes = True


class UserDetail(BaseModel):
    id: int
    username: str
    email: str
    full_name: str
    role: Optional[str] = None
    external_id: Optional[str] = None
    family_code: Optional[str] = None
    photo_url: Optional[str] = None
    status: str = "active"
    is_active: bool = True
    last_synced_at: Optional[datetime] = None
    allergies: Optional[str] = None
    # Phase 3.5b
    customer_type: Optional[str] = None
    staff_type: Optional[str] = None      # "Classified Staff" | "Certified Staff"
    ps_department: Optional[str] = None
    card_uid: Optional[str] = None
    has_children: bool = False
    family_profile: Optional[FamilyProfileItem] = None
    family_members: List[FamilyMember] = []
    identity_history: List[IdentityHistoryItem] = []
    # Shop assignment (multi-canteen)
    shop_id: Optional[str] = None
    shop_name: Optional[str] = None

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    external_id: Optional[str] = None
    external_id_change_reason: Optional[str] = Field(None, description="Required when external_id changes")
    family_code: Optional[str] = None
    photo_url: Optional[str] = None
    status: Optional[str] = None
    allergies: Optional[str] = None
    # Phase 3.5b
    card_uid: Optional[str] = None
    customer_type: Optional[str] = None
    # Shop assignment (multi-canteen) — null to unassign
    shop_id: Optional[str] = None


class LinkStudentRequest(BaseModel):
    child_customer_id: int
    relation: str = "guardian"
    parent_rank: Optional[str] = None  # "main" | "secondary" | null


class LinkStudentResponse(BaseModel):
    link_id: int
    parent_user_id: int
    child_customer_id: int
    relation: str
    parent_rank: Optional[str] = None
