"""
Shop & ShopProduct Schemas
"""
from typing import Literal, Optional, List
from datetime import datetime
from pydantic import BaseModel, Field
from app.models.shop import ShopType, MovementType, OptionSelectionType

ShopModule = Literal["canteen", "store"]


# ── Shop ──────────────────────────────────────────────────────────────────────

class ShopBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    shop_type: ShopType = ShopType.avg_cost
    description: Optional[str] = None
    allow_department_charge: bool = False
    module: ShopModule = "store"
    uses_dual_pricing: bool = True


class ShopCreate(ShopBase):
    id: str = Field(..., min_length=1, max_length=50, description="Unique shop code e.g. 'coop'")


class ShopUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    is_active: Optional[bool] = None
    allow_department_charge: Optional[bool] = None
    module: Optional[ShopModule] = None
    uses_dual_pricing: Optional[bool] = None


class ShopResponse(ShopBase):
    id: str
    is_active: bool
    created_at: datetime
    products_order_version: int = 1

    model_config = {"from_attributes": True}


class ShopDeleteResponse(BaseModel):
    status: Literal["deleted", "deactivated"]
    receipts_preserved: int = 0


# ── ShopCategory ──────────────────────────────────────────────────────────────

class ShopCategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class ShopCategoryUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class ShopCategoryResponse(BaseModel):
    id: str
    shop_id: str
    name: str

    model_config = {"from_attributes": True}


# ── ShopProduct ───────────────────────────────────────────────────────────────

class ShopProductCreate(BaseModel):
    product_code: str = Field(..., min_length=1, max_length=50)
    barcode: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=255)
    category: str = "ทั่วไป"
    external_price: float = Field(..., ge=0)
    internal_price: Optional[float] = None
    vat_percent: float = Field(default=7.0, ge=0, le=100)
    avg_cost: float = Field(default=0.0, ge=0)
    stock: int = Field(default=0)
    min_stock: int = Field(default=0, ge=0)
    color: Optional[str] = None


class ShopProductUpdate(BaseModel):
    product_code: Optional[str] = Field(None, min_length=1, max_length=50)
    barcode: Optional[str] = None
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    category: Optional[str] = None
    external_price: Optional[float] = Field(None, ge=0)
    internal_price: Optional[float] = Field(None, ge=0)
    vat_percent: Optional[float] = Field(None, ge=0, le=100)
    min_stock: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None
    # Explicit null clears the photo (keeps value at Cloudinary for recovery).
    photo_url: Optional[str] = None
    color: Optional[str] = None


class ShopProductResponse(BaseModel):
    id: int
    shop_id: str
    product_code: str
    barcode: Optional[str] = None
    name: str
    category: str
    external_price: float
    internal_price: float
    vat_percent: float
    avg_cost: float
    stock: int
    min_stock: int
    is_active: bool = True
    photo_url: Optional[str] = None
    color: Optional[str] = None
    sort_order: int = 0
    has_options: bool = False  # true iff the product has ≥1 menu option group

    model_config = {"from_attributes": True}


# ── Product reorder ───────────────────────────────────────────────────────────

class ReorderRequest(BaseModel):
    """Bulk product-order update with optimistic-concurrency guard."""
    version: int = Field(..., ge=1, description="Last-seen products_order_version")
    sort_map: dict[int, int] = Field(
        ..., description="Mapping of product_id -> new sort_order (0-based or 1-based; lower = earlier)",
    )
    source: Optional[Literal["admin", "pos"]] = None


class ReorderConflictResponse(BaseModel):
    """Returned with HTTP 409 when the client's `version` is stale."""
    detail: str = "Product order has changed since you started editing"
    current_version: int
    last_changed_by: Optional[int] = None
    last_changed_at: Optional[datetime] = None
    products: List[ShopProductResponse]


class ReorderResponse(BaseModel):
    version: int
    updated: int  # number of rows whose sort_order actually changed


class OrderHistoryEntry(BaseModel):
    id: int
    shop_id: str
    version: int
    sort_map: dict
    changed_by: Optional[int] = None
    changed_at: datetime
    source: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Menu options ──────────────────────────────────────────────────────────────

class MenuOptionBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    price_delta: float = Field(default=0.0)
    sort_order: int = 0


class MenuOptionCreate(MenuOptionBase):
    pass


class MenuOptionResponse(MenuOptionBase):
    id: int

    model_config = {"from_attributes": True}


class MenuOptionGroupBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    selection_type: OptionSelectionType
    is_required: bool = False
    max_selections: Optional[int] = Field(None, ge=1)
    sort_order: int = 0


class MenuOptionGroupCreate(MenuOptionGroupBase):
    options: List[MenuOptionCreate] = Field(default_factory=list)


class MenuOptionGroupUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    selection_type: Optional[OptionSelectionType] = None
    is_required: Optional[bool] = None
    max_selections: Optional[int] = Field(None, ge=1)
    sort_order: Optional[int] = None
    # If provided, replaces the full set of options for this group.
    options: Optional[List[MenuOptionCreate]] = None


class MenuOptionGroupResponse(MenuOptionGroupBase):
    id: int
    product_id: int
    options: List[MenuOptionResponse] = []

    model_config = {"from_attributes": True}


# ── Batch import (P2.4) ───────────────────────────────────────────────────────

class BatchImportRequest(BaseModel):
    items: List[ShopProductCreate] = Field(..., min_length=1, max_length=500)


class BatchImportError(BaseModel):
    row: int
    product_code: Optional[str] = None
    error: str


class BatchImportResult(BaseModel):
    total: int
    created: int
    skipped: int
    errors: List[BatchImportError] = []
    created_products: List[ShopProductResponse] = []


# ── FifoLot ───────────────────────────────────────────────────────────────────

class FifoLotResponse(BaseModel):
    id: str
    product_id: int
    date: str
    qty_remaining: float
    cost_per_unit: float

    model_config = {"from_attributes": True}


# ── Stock Movements ───────────────────────────────────────────────────────────

class ShopMovementResponse(BaseModel):
    id: int
    date: str
    product_id: Optional[int]
    product_name: str
    shop_id: str
    type: MovementType
    quantity: int
    stock_before: int
    stock_after: int
    cost_per_unit: Optional[float] = None
    reference: Optional[str] = None
    note: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Receive Stock ─────────────────────────────────────────────────────────────

class ReceiveBatchItem(BaseModel):
    product_id: int
    qty: int = Field(..., gt=0)
    cost_per_unit: float = Field(..., ge=0)
    po: Optional[str] = None
    invoice: Optional[str] = None
    note: Optional[str] = None


class ReceiveStockRequest(BaseModel):
    items: List[ReceiveBatchItem] = Field(..., min_length=1)


# ── Adjust Stock ──────────────────────────────────────────────────────────────

class AdjustStockRequest(BaseModel):
    product_id: int
    delta: int = Field(..., description="Positive = add, negative = remove. Cannot be 0.")
    reason: str = Field(..., min_length=1)
    cost_per_unit: Optional[float] = Field(None, ge=0, description="FIFO only, for positive delta")


# ── Shop Stats ────────────────────────────────────────────────────────────────

class ShopStatsResponse(BaseModel):
    total_products: int
    low_stock_count: int
    total_value: float
