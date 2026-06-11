"""
SpendingGroup Pydantic schemas.

Validators:
- code: ^[a-z][a-z0-9_]{1,38}$ (snake_case, can't start with digit, ≤40 chars total)
- daily_limit: gt=0
"""
import re
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, field_validator


_CODE_RE = re.compile(r'^[a-z][a-z0-9_]{1,38}$')


class SpendingGroupCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=40, description="snake_case unique identifier")
    name_en: str = Field(..., min_length=1, max_length=100)
    name_th: str = Field(..., min_length=1, max_length=100)
    daily_limit: float = Field(..., gt=0, description="THB per day, per user")
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def validate_code(cls, v: str) -> str:
        if not _CODE_RE.match(v):
            raise ValueError(
                "code must be snake_case: start with a lowercase letter, "
                "followed by lowercase letters, digits, or underscores (2-40 chars)"
            )
        return v


class SpendingGroupUpdate(BaseModel):
    name_en: Optional[str] = Field(None, min_length=1, max_length=100)
    name_th: Optional[str] = Field(None, min_length=1, max_length=100)
    daily_limit: Optional[float] = Field(None, gt=0)
    is_active: Optional[bool] = None


class SpendingGroupResponse(BaseModel):
    id: int
    code: str
    name_en: str
    name_th: str
    daily_limit: float
    is_active: bool
    created_at: datetime
    updated_at: datetime
    # Computed at query time — number of shops linked to this group
    linked_shop_count: int = 0

    model_config = {"from_attributes": True}


class SpendingGroupUsageResponse(BaseModel):
    """Result of usage-today query for a single group + payer."""
    spending_group_id: int
    code: str
    name_en: str
    name_th: str
    daily_limit: float
    spent_today: float
    remaining: float
