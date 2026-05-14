from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime


class PricePanelCreate(BaseModel):
    name: str
    color: Optional[str] = None


class PricePanelUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class PricePanelItemResponse(BaseModel):
    product_id: int
    product_code: str
    product_name: str
    external_price: float
    panel_price: Optional[float] = None  # null = not set

    class Config:
        from_attributes = True


class PricePanelResponse(BaseModel):
    id: int
    shop_id: str
    name: str
    color: Optional[str] = None
    sort_order: int
    created_at: datetime

    class Config:
        from_attributes = True


class PricePanelItemPatch(BaseModel):
    price: Optional[float] = None  # null clears the override
