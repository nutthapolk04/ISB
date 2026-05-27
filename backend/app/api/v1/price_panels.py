"""
Price Panel API Routes
GET    /api/v1/shops/{shop_id}/price-panels                        — list panels
POST   /api/v1/shops/{shop_id}/price-panels                        — create panel (auto-creates null items for all products)
PATCH  /api/v1/shops/{shop_id}/price-panels/{panel_id}             — rename/recolor panel
DELETE /api/v1/shops/{shop_id}/price-panels/{panel_id}             — delete panel
GET    /api/v1/shops/{shop_id}/price-panels/{panel_id}/items       — get all items with prices
PATCH  /api/v1/shops/{shop_id}/price-panels/{panel_id}/items/{product_id} — set price for one product (auto-save)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user, require_role
from app.models.price_panel import PricePanel, PricePanelItem
from app.models.shop import ShopProduct
from app.models.user import User
from app.schemas.price_panel import (
    PricePanelCreate, PricePanelUpdate, PricePanelResponse,
    PricePanelItemResponse, PricePanelItemPatch,
)

router = APIRouter()


def _get_panel_or_404(db: Session, shop_id: str, panel_id: int) -> PricePanel:
    panel = db.query(PricePanel).filter(
        PricePanel.id == panel_id,
        PricePanel.shop_id == shop_id,
    ).first()
    if not panel:
        raise HTTPException(status_code=404, detail="Price panel not found")
    return panel


@router.get("/{shop_id}/price-panels", response_model=List[PricePanelResponse])
def list_panels(
    shop_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(PricePanel).filter(PricePanel.shop_id == shop_id).order_by(PricePanel.sort_order, PricePanel.id).all()


@router.post("/{shop_id}/price-panels", response_model=PricePanelResponse, status_code=201)
def create_panel(
    shop_id: str,
    body: PricePanelCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    panel = PricePanel(shop_id=shop_id, name=body.name, color=body.color)
    db.add(panel)
    db.flush()
    # Auto-create null items for all existing products in this shop
    products = db.query(ShopProduct).filter(ShopProduct.shop_id == shop_id, ShopProduct.is_active == True).all()
    for p in products:
        db.add(PricePanelItem(panel_id=panel.id, product_id=p.id, price=None))
    db.commit()
    db.refresh(panel)
    return panel


@router.patch("/{shop_id}/price-panels/{panel_id}", response_model=PricePanelResponse)
def update_panel(
    shop_id: str,
    panel_id: int,
    body: PricePanelUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    panel = _get_panel_or_404(db, shop_id, panel_id)
    if body.name is not None:
        panel.name = body.name
    if body.color is not None:
        panel.color = body.color
    db.commit()
    db.refresh(panel)
    return panel


@router.delete("/{shop_id}/price-panels/{panel_id}", status_code=204)
def delete_panel(
    shop_id: str,
    panel_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    panel = _get_panel_or_404(db, shop_id, panel_id)
    db.delete(panel)
    db.commit()


@router.get("/{shop_id}/price-panels/{panel_id}/items", response_model=List[PricePanelItemResponse])
def get_panel_items(
    shop_id: str,
    panel_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    panel = _get_panel_or_404(db, shop_id, panel_id)
    # Get all active products in shop, join with panel items
    products = (
        db.query(ShopProduct)
        .filter(ShopProduct.shop_id == shop_id, ShopProduct.is_active == True)
        .order_by(ShopProduct.sort_order, ShopProduct.id)
        .all()
    )
    # Build lookup map: product_id -> panel item
    item_map = {
        item.product_id: item
        for item in db.query(PricePanelItem).filter(PricePanelItem.panel_id == panel_id).all()
    }
    return [
        PricePanelItemResponse(
            product_id=p.id,
            product_code=p.product_code,
            product_name=p.name,
            external_price=float(p.external_price),
            panel_price=float(item_map[p.id].price) if item_map.get(p.id) is not None and item_map[p.id].price is not None else None,
            short_name=item_map[p.id].short_name if item_map.get(p.id) is not None else None,
            included=getattr(item_map[p.id], 'included', True) if item_map.get(p.id) is not None else True,
        )
        for p in products
    ]


@router.patch("/{shop_id}/price-panels/{panel_id}/items/{product_id}", response_model=PricePanelItemResponse)
def set_item_price(
    shop_id: str,
    panel_id: int,
    product_id: int,
    body: PricePanelItemPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    _get_panel_or_404(db, shop_id, panel_id)
    product = db.query(ShopProduct).filter(ShopProduct.id == product_id, ShopProduct.shop_id == shop_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    item = db.query(PricePanelItem).filter(
        PricePanelItem.panel_id == panel_id,
        PricePanelItem.product_id == product_id,
    ).first()
    if item:
        item.price = body.price
        if body.short_name is not None:
            item.short_name = body.short_name if body.short_name.strip() else None
        if body.included is not None:
            item.included = body.included
    else:
        item = PricePanelItem(panel_id=panel_id, product_id=product_id, price=body.price)
        db.add(item)
    db.commit()
    return PricePanelItemResponse(
        product_id=product.id,
        product_code=product.product_code,
        product_name=product.name,
        external_price=float(product.external_price),
        panel_price=float(item.price) if item.price is not None else None,
        short_name=item.short_name,
        included=getattr(item, 'included', True),
    )
