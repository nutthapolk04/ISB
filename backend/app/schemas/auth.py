"""
Auth Pydantic Schemas
"""
from typing import List, Optional
from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RoleResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None

    model_config = {"from_attributes": True}


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    full_name: str
    is_active: bool
    is_superuser: bool
    role: Optional[str] = None
    roles: List[RoleResponse] = []
    shop_id: Optional[str] = None
    shop_module: Optional[str] = None

    model_config = {"from_attributes": True}


class MeResponse(BaseModel):
    user: UserResponse
    permissions: List[str] = []


class CreateUserRequest(BaseModel):
    username: str
    password: str
    full_name: str
    email: Optional[str] = None
    is_superuser: bool = False
    role: str = "cashier"  # admin | manager | cashier | parent | student


class MockSSORequest(BaseModel):
    """Mock SSO — simulates Azure/Google OAuth callback."""
    email: str
    full_name: Optional[str] = None
    provider: str = "mock"  # azure | google | mock


class GoogleSSORequest(BaseModel):
    """Real Google OAuth — access_token from Google OAuth2 implicit flow."""
    access_token: str
