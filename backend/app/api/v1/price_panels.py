"""
Price Panel API Routes
GET    /api/v1/shops/{shop_id}/price-panels                        — list panels
POST   /api/v1/shops/{shop_id}/price-panels                        — create panel (starts empty; products are added explicitly)
PATCH  /api/v1/shops/{shop_id}/price-panels/{panel_id}             — rename/recolor panel
DELETE /api/v1/shops/{shop_id}/price-panels/{panel_id}             — delete panel
GET    /api/v1/shops/{shop_id}/price-panels/{panel_id}/items       — list every shop product joined with panel rows (included=false for products without a row)
PATCH  /api/v1/shops/{shop_id}/price-panels/{panel_id}/items/{product_id} — set price / add / remove product (auto-save, upserts row)
"""
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db
from app.api.deps import get_current_user, require_role
from app.models.price_panel import PricePanel, PricePanelItem
from app.models.shop import ShopProduct
from app.models.bundle import ProductBundle
from app.models.user import User
from app.schemas.price_panel import (
    PricePanelCreate, PricePanelUpdate, PricePanelResponse,
    PricePanelItemResponse, PricePanelItemPatch,
)

logger = logging.getLogger(__name__)

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


def _has_bundle_id_column(db: Session) -> bool:
    """Schema patches run via start.sh, but a failed/queued deploy can leave
    the bundle_id column missing on production. Detect that explicitly so the
    endpoint can fall back to the product-only path with a clean 200 instead
    of crashing the whole query with a 500 the browser can't read past CORS."""
    try:
        row = db.execute(text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'price_panel_items' AND column_name = 'bundle_id'"
        )).first()
        return row is not None
    except Exception:
        return False


@router.get("/{shop_id}/price-panels/{panel_id}/items", response_model=List[PricePanelItemResponse])
def get_panel_items(
    shop_id: str,
    panel_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    panel = _get_panel_or_404(db, shop_id, panel_id)
    products = (
        db.query(ShopProduct)
        .filter(ShopProduct.shop_id == shop_id, ShopProduct.is_active == True)
        .order_by(ShopProduct.sort_order, ShopProduct.id)
        .all()
    )

    bundle_id_available = _has_bundle_id_column(db)
    if bundle_id_available:
        bundles = (
            db.query(ProductBundle)
            .filter(ProductBundle.shop_id == shop_id, ProductBundle.is_active == True)
            .order_by(ProductBundle.sort_order, ProductBundle.id)
            .all()
        )
    else:
        # Production schema not yet patched — log and proceed as products-only
        # so the panel still loads. Bundles will show up once the deploy
        # finishes (or once the patch is re-run).
        logger.warning(
            "price_panel_items.bundle_id missing — falling back to product-only response for panel %s",
            panel_id,
        )
        bundles = []

    # Build separate lookup maps so a panel row never collides between a
    # product id and a bundle id that happen to share the same number.
    # Use raw SQL when bundle_id column doesn't exist yet — going through the
    # ORM here would SELECT bundle_id and explode with a "column does not
    # exist" error that browsers swallow behind CORS.
    if bundle_id_available:
        rows = db.query(PricePanelItem).filter(PricePanelItem.panel_id == panel_id).all()
        product_item_map = {r.product_id: r for r in rows if r.product_id is not None}
        bundle_item_map = {r.bundle_id: r for r in rows if r.bundle_id is not None}
    else:
        raw_rows = db.execute(
            text(
                "SELECT product_id, price, short_name, included "
                "FROM price_panel_items WHERE panel_id = :pid"
            ),
            {"pid": panel_id},
        ).fetchall()

        class _RowStub:
            def __init__(self, product_id, price, short_name, included):
                self.product_id = product_id
                self.price = price
                self.short_name = short_name
                self.included = included

        product_item_map = {
            r[0]: _RowStub(r[0], r[1], r[2], r[3]) for r in raw_rows if r[0] is not None
        }
        bundle_item_map = {}

    out: list[PricePanelItemResponse] = []
    # Newly created panels start empty: rows that don't exist mean included=False
    # so the Add Product popover surfaces every product/bundle as a candidate.
    for p in products:
        r = product_item_map.get(p.id)
        out.append(PricePanelItemResponse(
            kind="product",
            product_id=p.id,
            bundle_id=None,
            product_code=p.product_code,
            product_name=p.name,
            external_price=float(p.external_price),
            panel_price=float(r.price) if r is not None and r.price is not None else None,
            short_name=r.short_name if r is not None else None,
            included=getattr(r, "included", True) if r is not None else False,
            is_bundle=False,
        ))
    for b in bundles:
        r = bundle_item_map.get(b.id)
        out.append(PricePanelItemResponse(
            kind="bundle",
            # product_id is reused as the stable row key on the frontend; for
            # bundle rows we put the bundle id here so the existing
            # selectedItems / table-key flow keeps working unchanged.
            product_id=b.id,
            bundle_id=b.id,
            product_code=b.bundle_code,
            product_name=b.name,
            external_price=float(b.external_price),
            panel_price=float(r.price) if r is not None and r.price is not None else None,
            short_name=r.short_name if r is not None else None,
            included=getattr(r, "included", True) if r is not None else False,
            is_bundle=True,
        ))
    return out


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
    # If the bundle_id column is missing in DB the ORM-level SELECT below would
    # blow up. Defer it in that case so the SELECT only touches columns that
    # are guaranteed to exist.
    if _has_bundle_id_column(db):
        item = db.query(PricePanelItem).filter(
            PricePanelItem.panel_id == panel_id,
            PricePanelItem.product_id == product_id,
        ).first()
    else:
        from sqlalchemy.orm import defer
        item = (
            db.query(PricePanelItem)
            .options(defer(PricePanelItem.bundle_id))
            .filter(
                PricePanelItem.panel_id == panel_id,
                PricePanelItem.product_id == product_id,
            )
            .first()
        )
    if item:
        item.price = body.price
        if body.short_name is not None:
            item.short_name = body.short_name if body.short_name.strip() else None
        if body.included is not None:
            item.included = body.included
    else:
        item = PricePanelItem(panel_id=panel_id, product_id=product_id, price=body.price)
        if body.short_name is not None:
            item.short_name = body.short_name if body.short_name.strip() else None
        if body.included is not None:
            item.included = body.included
        db.add(item)
    # Build the response BEFORE commit: SQLAlchemy expires all instance attrs
    # after commit, so accessing item.included/short_name later would trigger
    # a refresh SELECT — which fails if bundle_id is missing from the DB.
    response = PricePanelItemResponse(
        kind="product",
        product_id=product.id,
        bundle_id=None,
        product_code=product.product_code,
        product_name=product.name,
        external_price=float(product.external_price),
        panel_price=float(item.price) if item.price is not None else None,
        short_name=item.short_name,
        included=item.included if item.included is not None else True,
        is_bundle=False,
    )
    db.commit()
    return response


@router.patch("/{shop_id}/price-panels/{panel_id}/bundle-items/{bundle_id}", response_model=PricePanelItemResponse)
def set_bundle_item_price(
    shop_id: str,
    panel_id: int,
    bundle_id: int,
    body: PricePanelItemPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager", "cashier")),
):
    """Same semantics as set_item_price but for a bundle row in this panel."""
    _get_panel_or_404(db, shop_id, panel_id)
    bundle = db.query(ProductBundle).filter(
        ProductBundle.id == bundle_id, ProductBundle.shop_id == shop_id
    ).first()
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    item = db.query(PricePanelItem).filter(
        PricePanelItem.panel_id == panel_id,
        PricePanelItem.bundle_id == bundle_id,
    ).first()
    if item:
        item.price = body.price
        if body.short_name is not None:
            item.short_name = body.short_name if body.short_name.strip() else None
        if body.included is not None:
            item.included = body.included
    else:
        item = PricePanelItem(panel_id=panel_id, bundle_id=bundle_id, price=body.price)
        if body.short_name is not None:
            item.short_name = body.short_name if body.short_name.strip() else None
        if body.included is not None:
            item.included = body.included
        db.add(item)
    # Build response BEFORE commit — see comment in set_item_price.
    response = PricePanelItemResponse(
        kind="bundle",
        product_id=bundle.id,
        bundle_id=bundle.id,
        product_code=bundle.bundle_code,
        product_name=bundle.name,
        external_price=float(bundle.external_price),
        panel_price=float(item.price) if item.price is not None else None,
        short_name=item.short_name,
        included=item.included if item.included is not None else True,
        is_bundle=True,
    )
    db.commit()
    return response
