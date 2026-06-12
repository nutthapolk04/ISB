"""
Pydantic schemas for shop-scoped User Management (Sitemap v2).

These schemas back the `/api/v1/users` endpoints used by admins and
per-shop managers to manage cashiers within their shop.
"""
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# Allowed role values for create/update payloads. Admins bypass restrictions
# at the API layer, so this literal simply enforces the vocabulary.
UserRole = Literal["cashier", "manager", "admin", "parent", "student", "refund_officer"]


class UserResponse(BaseModel):
    """Response schema for a single user."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: Optional[str] = None
    full_name: str
    role: Optional[str] = None
    is_active: bool = True
    is_superuser: bool = False
    shop_id: Optional[str] = None
    shop_name: Optional[str] = None
    shop_module: Optional[str] = None
    external_id: Optional[str] = None
    family_code: Optional[str] = None
    status: Optional[str] = None
    created_at: Optional[datetime] = None


class UserCreate(BaseModel):
    """Payload for creating a new user (admin or manager)."""
    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=6, max_length=128)
    full_name: str = Field(..., min_length=1, max_length=255)
    role: UserRole
    shop_id: Optional[str] = None
    email: Optional[str] = None
    family_code: Optional[str] = Field(None, max_length=20)


class UserUpdate(BaseModel):
    """Payload for updating an existing user."""
    shop_id: Optional[str] = None
    role: Optional[UserRole] = None
    full_name: Optional[str] = None
    is_active: Optional[bool] = None
    email: Optional[str] = None
    family_code: Optional[str] = Field(None, max_length=20)


class UserListResponse(BaseModel):
    """Paginated list response."""
    items: List[UserResponse]
    total: int
