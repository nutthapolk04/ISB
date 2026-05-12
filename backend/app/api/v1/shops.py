"""
Shops API — CRUD for shops and per-shop resources.
"""
import time
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_active_user
from app.models.user import User
from app.models.shop import Shop, ShopType
from app.schemas.shop import (
    ShopCreate, ShopUpdate, ShopResponse,
    ShopStatsResponse, ShopDeleteResponse,
)

router = APIRouter()


# ── Shop CRUD ─────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[ShopResponse])
def list_shops(
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
):
    """List all shops (active by default)."""
    q = db.query(Shop)
    if active_only:
        q = q.filter(Shop.is_active == True)
    return q.order_by(Shop.id).all()


@router.post("/", response_model=ShopResponse, status_code=status.HTTP_201_CREATED)
def create_shop(
    body: ShopCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new shop. Requires admin."""
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Admin only")
    if db.query(Shop).filter(Shop.id == body.id).first():
        raise HTTPException(status_code=409, detail=f"Shop '{body.id}' already exists")
    shop = Shop(**body.model_dump())
    db.add(shop)
    db.commit()
    db.refresh(shop)
    return shop


@router.get("/{shop_id}", response_model=ShopResponse)
def get_shop(
    shop_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
):
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return shop


@router.patch("/{shop_id}", response_model=ShopResponse)
def update_shop(
    shop_id: str,
    body: ShopUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update shop name / description / active status. Requires admin."""
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Admin only")
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(shop, field, value)
    db.commit()
    db.refresh(shop)
    return shop


@router.delete("/{shop_id}", response_model=ShopDeleteResponse)
def delete_shop(
    shop_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Delete a shop. Admin only.

    Behavior:
    - If any Receipt references this shop → soft-delete (set is_active=False)
      to preserve audit trail.
    - Otherwise → hard-delete (ORM cascade removes products, categories,
      movements, FIFO lots via `cascade="all, delete-orphan"`).
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Admin only")
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    from app.models.receipt import Receipt
    ref_count = db.query(Receipt).filter(Receipt.shop_id == shop_id).count()

    if ref_count > 0:
        # Soft-delete to preserve receipt history
        shop.is_active = False
        db.commit()
        return ShopDeleteResponse(status="deactivated", receipts_preserved=ref_count)

    # Hard-delete — safe, no receipts reference this shop
    # Also unassign any users scoped to this shop (keep users, just clear shop_id)
    db.query(User).filter(User.shop_id == shop_id).update({"shop_id": None})
    db.delete(shop)
    db.commit()
    return ShopDeleteResponse(status="deleted", receipts_preserved=0)


@router.get("/{shop_id}/stats", response_model=ShopStatsResponse)
def shop_stats(
    shop_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
):
    """KPI stats for a shop (total products, low stock, total value)."""
    from app.models.shop import ShopProduct
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    products = (
        db.query(ShopProduct)
        .filter(ShopProduct.shop_id == shop_id, ShopProduct.is_active == True)
        .all()
    )
    total_products = len(products)
    low_stock_count = sum(1 for p in products if p.stock <= p.min_stock)
    total_value = sum(p.stock * float(p.avg_cost) for p in products if p.stock > 0)
    return ShopStatsResponse(
        total_products=total_products,
        low_stock_count=low_stock_count,
        total_value=round(total_value, 2),
    )
