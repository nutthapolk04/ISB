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
    # Discriminator: "product" for ShopProduct rows, "bundle" for ProductBundle.
    kind: str = "product"
    # product_id stays as the stable per-row key the frontend already uses.
    # For bundle rows it carries the bundle's id and bundle_id mirrors it.
    product_id: int
    bundle_id: Optional[int] = None
    product_code: str
    product_name: str
    external_price: float
    panel_price: Optional[float] = None  # null = not set
    short_name: Optional[str] = None
    included: bool = True
    is_bundle: bool = False

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
    short_name: Optional[str] = None
    included: Optional[bool] = None
