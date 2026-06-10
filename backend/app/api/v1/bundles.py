"""
Product Bundles / Grade Sets API
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.api.deps import get_current_user, require_role
from app.models.user import User
from app.models.bundle import ProductBundle, BundleItem
from app.models.shop import Shop, ShopProduct

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class BundleItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(default=1, ge=1)


class BundleItemResponse(BaseModel):
    id: int
    product_id: int
    product_name: str
    product_code: str
    quantity: int
    unit_price: float  # Price per unit of the product
    sort_order: int

    class Config:
        from_attributes = True


class BundleCreate(BaseModel):
    bundle_code: str = Field(..., min_length=1, max_length=50)
    barcode: Optional[str] = Field(None, max_length=100)
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    external_price: float = Field(..., ge=0)
    internal_price: Optional[float] = None
    color: Optional[str] = None
    items: List[BundleItemCreate] = Field(..., min_length=1)


class BundleUpdate(BaseModel):
    bundle_code: Optional[str] = Field(None, min_length=1, max_length=50)
    barcode: Optional[str] = Field(None, max_length=100)
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    external_price: Optional[float] = Field(None, ge=0)
    internal_price: Optional[float] = Field(None, ge=0)
    photo_url: Optional[str] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None
    items: Optional[List[BundleItemCreate]] = None  # If provided, replaces all items


class BundleResponse(BaseModel):
    id: int
    shop_id: str
    bundle_code: str
    barcode: Optional[str] = None
    name: str
    description: Optional[str] = None
    external_price: float
    internal_price: float
    photo_url: Optional[str] = None
    color: Optional[str] = None
    sort_order: int
    is_active: bool
    items: List[BundleItemResponse] = []
    # Computed fields
    total_items_value: float  # Sum of individual item prices
    savings: float  # Difference between items value and bundle price

    class Config:
        from_attributes = True


# ── Helper functions ─────────────────────────────────────────────────────────

def _get_shop_or_404(shop_id: str, db: Session) -> Shop:
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return shop


def _bundle_to_response(bundle: ProductBundle) -> BundleResponse:
    items = []
    total_items_value = 0.0

    for item in bundle.items:
        product = item.product
        if product:
            unit_price = float(product.external_price)
            items.append(BundleItemResponse(
                id=item.id,
                product_id=item.product_id,
                product_name=product.name,
                product_code=product.product_code,
                quantity=item.quantity,
                unit_price=unit_price,
                sort_order=item.sort_order,
            ))
            total_items_value += unit_price * item.quantity

    external_price = float(bundle.external_price)
    return BundleResponse(
        id=bundle.id,
        shop_id=bundle.shop_id,
        bundle_code=bundle.bundle_code,
        barcode=bundle.barcode,
        name=bundle.name,
        description=bundle.description,
        external_price=external_price,
        internal_price=float(bundle.internal_price),
        photo_url=bundle.photo_url,
        color=bundle.color,
        sort_order=bundle.sort_order,
        is_active=bundle.is_active,
        items=items,
        total_items_value=total_items_value,
        savings=max(0, total_items_value - external_price),
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/{shop_id}/bundles", response_model=List[BundleResponse])
def list_bundles(
    shop_id: str,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all bundles for a shop."""
    _get_shop_or_404(shop_id, db)

    query = (
        db.query(ProductBundle)
        .filter(ProductBundle.shop_id == shop_id)
        .options(selectinload(ProductBundle.items).selectinload(BundleItem.product))
    )

    if not include_inactive:
        query = query.filter(ProductBundle.is_active == True)

    bundles = query.order_by(ProductBundle.sort_order, ProductBundle.name).all()
    return [_bundle_to_response(b) for b in bundles]


@router.get("/{shop_id}/bundles/{bundle_id}", response_model=BundleResponse)
def get_bundle(
    shop_id: str,
    bundle_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific bundle."""
    _get_shop_or_404(shop_id, db)

    bundle = (
        db.query(ProductBundle)
        .filter(ProductBundle.id == bundle_id, ProductBundle.shop_id == shop_id)
        .options(selectinload(ProductBundle.items).selectinload(BundleItem.product))
        .first()
    )

    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")

    return _bundle_to_response(bundle)


@router.post("/{shop_id}/bundles", response_model=BundleResponse, status_code=status.HTTP_201_CREATED)
def create_bundle(
    shop_id: str,
    payload: BundleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """Create a new product bundle."""
    shop = _get_shop_or_404(shop_id, db)

    # Check for duplicate bundle_code in this shop
    existing = db.query(ProductBundle).filter(
        ProductBundle.shop_id == shop_id,
        ProductBundle.bundle_code == payload.bundle_code,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Bundle code '{payload.bundle_code}' already exists in this shop")

    # Validate all product IDs exist in this shop
    product_ids = [item.product_id for item in payload.items]
    products = db.query(ShopProduct).filter(
        ShopProduct.id.in_(product_ids),
        ShopProduct.shop_id == shop_id,
    ).all()

    if len(products) != len(product_ids):
        found_ids = {p.id for p in products}
        missing = [pid for pid in product_ids if pid not in found_ids]
        raise HTTPException(status_code=400, detail=f"Products not found in this shop: {missing}")

    # Create bundle
    bundle = ProductBundle(
        shop_id=shop_id,
        bundle_code=payload.bundle_code,
        barcode=payload.barcode,
        name=payload.name,
        description=payload.description,
        external_price=payload.external_price,
        internal_price=payload.internal_price if payload.internal_price is not None else payload.external_price,
        color=payload.color,
    )
    db.add(bundle)
    db.flush()

    # Add items
    for idx, item in enumerate(payload.items):
        bundle_item = BundleItem(
            bundle_id=bundle.id,
            product_id=item.product_id,
            quantity=item.quantity,
            sort_order=idx,
        )
        db.add(bundle_item)

    db.commit()
    db.refresh(bundle)

    # Reload with items
    bundle = (
        db.query(ProductBundle)
        .filter(ProductBundle.id == bundle.id)
        .options(selectinload(ProductBundle.items).selectinload(BundleItem.product))
        .first()
    )

    return _bundle_to_response(bundle)


@router.patch("/{shop_id}/bundles/{bundle_id}", response_model=BundleResponse)
def update_bundle(
    shop_id: str,
    bundle_id: int,
    payload: BundleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """Update a product bundle."""
    _get_shop_or_404(shop_id, db)

    bundle = (
        db.query(ProductBundle)
        .filter(ProductBundle.id == bundle_id, ProductBundle.shop_id == shop_id)
        .first()
    )
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")

    # Check for duplicate bundle_code if changing
    if payload.bundle_code and payload.bundle_code != bundle.bundle_code:
        existing = db.query(ProductBundle).filter(
            ProductBundle.shop_id == shop_id,
            ProductBundle.bundle_code == payload.bundle_code,
            ProductBundle.id != bundle_id,
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"Bundle code '{payload.bundle_code}' already exists")

    # Update fields
    if payload.bundle_code is not None:
        bundle.bundle_code = payload.bundle_code
    if payload.barcode is not None:
        # Empty string clears the barcode so cashier can remove it through
        # the same input rather than needing a separate delete action.
        bundle.barcode = payload.barcode.strip() or None
    if payload.name is not None:
        bundle.name = payload.name
    if payload.description is not None:
        bundle.description = payload.description
    if payload.external_price is not None:
        bundle.external_price = payload.external_price
    if payload.internal_price is not None:
        bundle.internal_price = payload.internal_price
    if payload.photo_url is not None:
        bundle.photo_url = payload.photo_url
    if payload.color is not None:
        bundle.color = payload.color
    if payload.is_active is not None:
        bundle.is_active = payload.is_active

    # Replace items if provided
    if payload.items is not None:
        # Validate all product IDs
        product_ids = [item.product_id for item in payload.items]
        products = db.query(ShopProduct).filter(
            ShopProduct.id.in_(product_ids),
            ShopProduct.shop_id == shop_id,
        ).all()

        if len(products) != len(product_ids):
            found_ids = {p.id for p in products}
            missing = [pid for pid in product_ids if pid not in found_ids]
            raise HTTPException(status_code=400, detail=f"Products not found: {missing}")

        # Delete existing items
        db.query(BundleItem).filter(BundleItem.bundle_id == bundle_id).delete()

        # Add new items
        for idx, item in enumerate(payload.items):
            bundle_item = BundleItem(
                bundle_id=bundle.id,
                product_id=item.product_id,
                quantity=item.quantity,
                sort_order=idx,
            )
            db.add(bundle_item)

    db.commit()

    # Reload with items
    bundle = (
        db.query(ProductBundle)
        .filter(ProductBundle.id == bundle.id)
        .options(selectinload(ProductBundle.items).selectinload(BundleItem.product))
        .first()
    )

    return _bundle_to_response(bundle)


@router.delete("/{shop_id}/bundles/{bundle_id}")
def delete_bundle(
    shop_id: str,
    bundle_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """Delete (deactivate) a bundle."""
    _get_shop_or_404(shop_id, db)

    bundle = (
        db.query(ProductBundle)
        .filter(ProductBundle.id == bundle_id, ProductBundle.shop_id == shop_id)
        .first()
    )
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")

    # Soft delete
    bundle.is_active = False
    db.commit()

    return {"success": True, "message": f"Bundle '{bundle.name}' deactivated"}


class BundleReorderRequest(BaseModel):
    sort_map: dict[str, int]


@router.post("/{shop_id}/bundles/reorder")
def reorder_bundles(
    shop_id: str,
    payload: BundleReorderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    """Reorder bundles. sort_map is {bundle_id: new_sort_order}."""
    _get_shop_or_404(shop_id, db)

    for bundle_id, sort_order in payload.sort_map.items():
        db.query(ProductBundle).filter(
            ProductBundle.id == int(bundle_id),
            ProductBundle.shop_id == shop_id,
        ).update({"sort_order": sort_order})

    db.commit()

    return {"success": True}


# ── Stock availability check ─────────────────────────────────────────────────

class BundleStockStatus(BaseModel):
    bundle_id: int
    available: bool
    max_quantity: int  # How many bundles can be made with current stock
    items: List[dict]  # Stock status per item


@router.get("/{shop_id}/bundles/{bundle_id}/stock", response_model=BundleStockStatus)
def check_bundle_stock(
    shop_id: str,
    bundle_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Check if a bundle can be sold based on item stock levels."""
    _get_shop_or_404(shop_id, db)

    bundle = (
        db.query(ProductBundle)
        .filter(ProductBundle.id == bundle_id, ProductBundle.shop_id == shop_id)
        .options(selectinload(ProductBundle.items).selectinload(BundleItem.product))
        .first()
    )
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")

    items_status = []
    max_bundles = float('inf')

    for item in bundle.items:
        product = item.product
        if not product:
            items_status.append({
                "product_id": item.product_id,
                "product_name": "Unknown",
                "required": item.quantity,
                "available": 0,
                "sufficient": False,
            })
            max_bundles = 0
            continue

        can_make = product.stock // item.quantity if item.quantity > 0 else float('inf')
        items_status.append({
            "product_id": product.id,
            "product_name": product.name,
            "required": item.quantity,
            "available": product.stock,
            "sufficient": product.stock >= item.quantity,
            "max_bundles": can_make,
        })
        max_bundles = min(max_bundles, can_make)

    return BundleStockStatus(
        bundle_id=bundle.id,
        available=max_bundles > 0,
        max_quantity=int(max_bundles) if max_bundles != float('inf') else 999999,
        items=items_status,
    )
