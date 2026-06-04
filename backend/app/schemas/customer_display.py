"""Pydantic schemas for the customer display admin API."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class CustomerDisplayImageResponse(BaseModel):
    """List item — no binary payload, only metadata. Frontend fetches the
    binary separately via /images/{id}/binary which is browser-cached."""

    id: int
    content_type: str
    filename: Optional[str] = None
    size_bytes: int
    sort_order: int
    uploaded_at: datetime
    uploaded_by: Optional[int] = None

    class Config:
        from_attributes = True


class CustomerDisplayImageReorder(BaseModel):
    """PATCH /admin/customer-display/images/order body — reorder by id list."""

    ordered_ids: List[int] = Field(
        ..., description="Image ids in the desired new order (front to back)."
    )
