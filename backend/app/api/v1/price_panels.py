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

router = APIRouter()
logger = logging.getLogger(__name__)


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
    bundles = (
        db.query(ProductBundle)
        .filter(ProductBundle.shop_id == shop_id, ProductBundle.is_active == True)
        .order_by(ProductBundle.sort_order, ProductBundle.id)
        .all()
    )

    # Self-healing schema bootstrap: try ORM. If bundle_id column is missing
    # (start.sh patch didn't land, or Railway dropped the patch line past its
    # 500 logs/sec rate limit), add the column on the fly and retry. This
    # avoids the "waiting for the next deploy" trap that left managers stuck
    # in production for hours after the bundle feature shipped.
    bundle_id_available = True
    try:
        rows = db.query(PricePanelItem).filter(PricePanelItem.panel_id == panel_id).all()
        product_item_map = {r.product_id: r for r in rows if r.product_id is not None}
        bundle_item_map  = {r.bundle_id:  r for r in rows if r.bundle_id  is not None}
    except Exception as _orm_err:
        if "bundle_id" not in str(_orm_err):
            raise
        # The failed ORM SELECT aborted the transaction; must rollback first.
        db.rollback()
        # Attempt the schema patch directly, then retry the ORM query. The
        # ALTER and the index are idempotent (IF NOT EXISTS) so re-running
        # them is safe. DDL runs inside the regular session transaction —
        # don't try to flip isolation_level here, SQLAlchemy refuses once the
        # session has auto-begun a transaction.
        try:
            db.execute(text(
                "ALTER TABLE price_panel_items ADD COLUMN IF NOT EXISTS bundle_id INTEGER"
            ))
            # Bundle rows store product_id=NULL, so the legacy NOT NULL on
            # product_id has to come off too. Idempotent: PG silently no-ops
            # DROP NOT NULL when the column is already nullable.
            db.execute(text(
                "ALTER TABLE price_panel_items ALTER COLUMN product_id DROP NOT NULL"
            ))
            db.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_price_panel_items_bundle_id "
                "ON price_panel_items(bundle_id)"
            ))
            db.commit()
            logger.warning(
                "price_panel_items.bundle_id/product_id nullable missing — patched on the fly"
            )
            rows = db.query(PricePanelItem).filter(PricePanelItem.panel_id == panel_id).all()
            product_item_map = {r.product_id: r for r in rows if r.product_id is not None}
            bundle_item_map  = {r.bundle_id:  r for r in rows if r.bundle_id  is not None}
        except Exception as _patch_err:
            # Couldn't add the column (e.g. permission denied) — degrade to
            # the legacy raw-SQL path so the page at least loads with
            # products. Bundles stay hidden in this branch.
            logger.error(
                "Failed to lazily add price_panel_items.bundle_id: %s", _patch_err
            )
            db.rollback()
            bundle_id_available = False
            raw = db.execute(
                text(
                    "SELECT id, panel_id, product_id, price, short_name, included "
                    "FROM price_panel_items WHERE panel_id = :pid"
                ),
                {"pid": panel_id},
            ).fetchall()
            class _FakeRow:
                def __init__(self, r):
                    self.product_id = r.product_id; self.bundle_id = None
                    self.price = r.price; self.short_name = r.short_name
                    self.included = r.included
            rows = [_FakeRow(r) for r in raw]
            product_item_map = {r.product_id: r for r in rows if r.product_id is not None}
            bundle_item_map  = {}

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
    # When bundle_id isn't migrated yet the bundle PATCH returns 503, so don't
    # surface bundles in the response — otherwise they show up as "+ Add"
    # candidates that just error out when clicked.
    bundles_to_emit = bundles if bundle_id_available else []
    for b in bundles_to_emit:
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

    # Same protection as get_panel_items: if bundle_id column is missing in DB
    # the ORM will SELECT/INSERT it and crash. Try ORM, on column-missing fall
    # back to raw-SQL upsert touching only the legacy columns.
    try:
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
            if body.short_name is not None:
                item.short_name = body.short_name if body.short_name.strip() else None
            if body.included is not None:
                item.included = body.included
            db.add(item)
        # Build response BEFORE commit: commit expires instance attrs which
        # would trigger a refresh SELECT on bundle_id.
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
    except Exception as _orm_err:
        if "bundle_id" not in str(_orm_err):
            raise
        db.rollback()
        normalised_short = (
            body.short_name.strip() if body.short_name and body.short_name.strip() else None
        ) if body.short_name is not None else None
        existing = db.execute(
            text(
                "SELECT id, price, short_name, included FROM price_panel_items "
                "WHERE panel_id = :pid AND product_id = :prid"
            ),
            {"pid": panel_id, "prid": product_id},
        ).first()
        if existing:
            final_short = normalised_short if body.short_name is not None else existing[2]
            final_included = body.included if body.included is not None else existing[3]
            db.execute(
                text(
                    "UPDATE price_panel_items SET price = :price, "
                    "short_name = :sn, included = :inc WHERE id = :rid"
                ),
                {"price": body.price, "sn": final_short,
                 "inc": final_included, "rid": existing[0]},
            )
        else:
            final_included = body.included if body.included is not None else True
            db.execute(
                text(
                    "INSERT INTO price_panel_items (panel_id, product_id, price, short_name, included) "
                    "VALUES (:pid, :prid, :price, :sn, :inc)"
                ),
                {"pid": panel_id, "prid": product_id, "price": body.price,
                 "sn": normalised_short, "inc": final_included},
            )
        db.commit()
        return PricePanelItemResponse(
            kind="product",
            product_id=product.id,
            bundle_id=None,
            product_code=product.product_code,
            product_name=product.name,
            external_price=float(product.external_price),
            panel_price=float(body.price) if body.price is not None else None,
            short_name=normalised_short,
            included=final_included if final_included is not None else True,
            is_bundle=False,
        )


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

    # Bundle rows require the bundle_id column. If the live DB hasn't received
    # the schema patch yet, every ORM write here would 500. Return a clear 503
    # instead of letting psycopg2 raise UndefinedColumn — the next start.sh
    # boot will land the column and this branch goes away.
    try:
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
    except Exception as _orm_err:
        if "bundle_id" not in str(_orm_err):
            raise
        # Try the same self-healing path as get_panel_items: add the column on
        # the fly so this very request (and every subsequent one) succeeds
        # without waiting for another deploy cycle.
        db.rollback()
        try:
            db.execute(text(
                "ALTER TABLE price_panel_items ADD COLUMN IF NOT EXISTS bundle_id INTEGER"
            ))
            # product_id must be nullable too — bundle rows leave it NULL.
            db.execute(text(
                "ALTER TABLE price_panel_items ALTER COLUMN product_id DROP NOT NULL"
            ))
            db.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_price_panel_items_bundle_id "
                "ON price_panel_items(bundle_id)"
            ))
            db.commit()
            logger.warning(
                "bundle_id/product_id nullable missing — patched on the fly from bundle PATCH"
            )
        except Exception as _patch_err:
            db.rollback()
            logger.error(
                "Failed to lazily add price_panel_items.bundle_id from bundle PATCH: %s",
                _patch_err,
            )
            raise HTTPException(
                status_code=503,
                detail=(
                    "Bundle support is being rolled out. The database schema "
                    "patch for this column hasn't shipped yet — please retry "
                    "after the next deploy completes."
                ),
            )
        # Column is in now — retry the original upsert via ORM.
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
