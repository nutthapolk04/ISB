"""
Inventory API — per-shop products, categories, movements, receive, adjust.
All routes are nested under /api/v1/shops/{shop_id}/...
"""
import logging
import time
from typing import List, Optional
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.api.deps import require_shop_access, require_shop_manager
from app.models.user import User

logger = logging.getLogger(__name__)
from app.models.shop import (
    Shop, ShopProduct, ShopCategory, ShopMovement, MovementType,
    MenuOptionGroup, MenuOption, ProductOrderHistory,
)
from app.models.fifo_lot import FifoLot
from app.models.unit_of_measure import UnitOfMeasure
from app.schemas.shop import (
    ShopProductCreate, ShopProductUpdate, ShopProductResponse,
    ShopCategoryCreate, ShopCategoryUpdate, ShopCategoryResponse,
    ShopMovementResponse, FifoLotResponse,
    ReceiveStockRequest, AdjustStockRequest,
    BatchImportRequest, BatchImportResult, BatchImportError,
    MenuOptionGroupCreate, MenuOptionGroupUpdate, MenuOptionGroupResponse,
    ReorderRequest, ReorderResponse, ReorderConflictResponse,
    OrderHistoryEntry,
)
from app.services.inventory_service import InventoryService
from app.services.audit_service import create_audit_log
from app.services.pos_service import POSService
from app.api.v1.pos import _receipt_to_response
from app.schemas.pos import ReceiptResponse
from pydantic import BaseModel, Field

router = APIRouter()


# ── Helper ────────────────────────────────────────────────────────────────────

def _get_shop_or_404(shop_id: str, db: Session) -> Shop:
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return shop


def _get_product_or_404(
    product_id: int, shop_id: str, db: Session, *, include_inactive: bool = True
) -> ShopProduct:
    q = db.query(ShopProduct).filter(
        ShopProduct.id == product_id, ShopProduct.shop_id == shop_id
    )
    if not include_inactive:
        q = q.filter(ShopProduct.is_active == True)
    product = q.first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


def _product_to_response(p: ShopProduct) -> ShopProductResponse:
    # p.option_groups is a relationship; loading it here is OK — list_products
    # eagerly joinedloads it to avoid N+1.
    has_options = bool(getattr(p, "option_groups", None))
    # UOM info (eagerly loaded or lazy)
    uom = getattr(p, "uom", None)
    return ShopProductResponse(
        id=p.id,
        shop_id=p.shop_id,
        product_code=p.product_code,
        barcode=p.barcode,
        name=p.name,
        category=p.category,
        external_price=float(p.external_price),
        internal_price=float(p.internal_price),
        vat_percent=float(p.vat_percent),
        avg_cost=float(p.avg_cost),
        stock=p.stock,
        min_stock=p.min_stock,
        is_active=bool(p.is_active),
        photo_url=p.photo_url,
        color=p.color,
        sort_order=p.sort_order,
        has_options=has_options,
        uom_id=p.uom_id,
        uom_code=uom.code if uom else None,
        uom_name=uom.name if uom else None,
    )


def _movement_to_response(m: ShopMovement) -> ShopMovementResponse:
    return ShopMovementResponse(
        id=m.id,
        date=str(m.date),
        product_id=m.product_id,
        product_name=m.product_name,
        shop_id=m.shop_id,
        type=m.type,
        quantity=m.quantity,
        stock_before=m.stock_before,
        stock_after=m.stock_after,
        cost_per_unit=float(m.cost_per_unit) if m.cost_per_unit is not None else None,
        reference=m.reference,
        note=m.note,
    )


# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/{shop_id}/categories", response_model=List[ShopCategoryResponse])
def list_categories(
    shop_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_access),
):
    _get_shop_or_404(shop_id, db)
    return db.query(ShopCategory).filter(ShopCategory.shop_id == shop_id).order_by(ShopCategory.name).all()


@router.post("/{shop_id}/categories", response_model=ShopCategoryResponse, status_code=201)
def create_category(
    shop_id: str,
    body: ShopCategoryCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_manager),
):
    _get_shop_or_404(shop_id, db)
    cat = ShopCategory(
        id=f"cat-{int(time.time() * 1000)}",
        shop_id=shop_id,
        name=body.name.strip(),
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.patch("/{shop_id}/categories/{category_id}", response_model=ShopCategoryResponse)
def update_category(
    shop_id: str,
    category_id: str,
    body: ShopCategoryUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_manager),
):
    cat = db.query(ShopCategory).filter(
        ShopCategory.id == category_id, ShopCategory.shop_id == shop_id
    ).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    cat.name = body.name.strip()
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/{shop_id}/categories/{category_id}", status_code=204)
def delete_category(
    shop_id: str,
    category_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_manager),
):
    cat = db.query(ShopCategory).filter(
        ShopCategory.id == category_id, ShopCategory.shop_id == shop_id
    ).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    db.delete(cat)
    db.commit()


# ── Products ──────────────────────────────────────────────────────────────────

@router.get("/{shop_id}/products", response_model=List[ShopProductResponse])
def list_products(
    shop_id: str,
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_access),
):
    _get_shop_or_404(shop_id, db)
    q = (
        db.query(ShopProduct)
        .filter(ShopProduct.shop_id == shop_id)
        .options(selectinload(ShopProduct.option_groups), selectinload(ShopProduct.uom))
    )
    if not include_inactive:
        q = q.filter(ShopProduct.is_active == True)
    if search:
        term = f"%{search.lower()}%"
        q = q.filter(
            (ShopProduct.name.ilike(term)) |
            (ShopProduct.product_code.ilike(term)) |
            (ShopProduct.barcode.ilike(term))
        )
    if category:
        q = q.filter(ShopProduct.category == category)
    # Honour per-shop drag-and-drop order; fall back to alphabetical for any
    # legacy rows that still have sort_order=0.
    return [
        _product_to_response(p)
        for p in q.order_by(ShopProduct.sort_order, ShopProduct.name).all()
    ]


# ── Product order (drag-and-drop) ─────────────────────────────────────────────

@router.post(
    "/{shop_id}/products/reorder",
    response_model=ReorderResponse,
    responses={409: {"model": ReorderConflictResponse}},
)
def reorder_products(
    shop_id: str,
    payload: ReorderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_manager),
):
    """Bulk-update sort_order for products in this shop.

    Optimistic concurrency: client sends the `version` they last fetched
    (from `Shop.products_order_version` returned with the products list).
    On version mismatch we return 409 with the current state so the UI can
    diff and ask the user how to reconcile.
    """
    shop = _get_shop_or_404(shop_id, db)

    if payload.version != shop.products_order_version:
        # Another editor saved first — return current state for the diff modal.
        products = (
            db.query(ShopProduct)
            .filter(ShopProduct.shop_id == shop_id)
            .options(selectinload(ShopProduct.option_groups))
            .order_by(ShopProduct.sort_order, ShopProduct.name)
            .all()
        )
        last_history = (
            db.query(ProductOrderHistory)
            .filter(ProductOrderHistory.shop_id == shop_id)
            .order_by(ProductOrderHistory.version.desc())
            .first()
        )
        body = ReorderConflictResponse(
            current_version=shop.products_order_version,
            last_changed_by=last_history.changed_by if last_history else None,
            last_changed_at=last_history.changed_at if last_history else None,
            products=[_product_to_response(p) for p in products],
        )
        raise HTTPException(status_code=409, detail=body.model_dump(mode="json"))

    # Apply new sort_order values; only count rows whose value actually changed.
    products_in_shop = (
        db.query(ShopProduct)
        .filter(ShopProduct.shop_id == shop_id)
        .all()
    )
    by_id = {p.id: p for p in products_in_shop}
    updated = 0
    for pid, new_order in payload.sort_map.items():
        p = by_id.get(int(pid))
        if not p:
            continue
        if p.sort_order != int(new_order):
            p.sort_order = int(new_order)
            updated += 1

    shop.products_order_version += 1

    # Persist history snapshot — string keys for JSON portability.
    db.add(ProductOrderHistory(
        shop_id=shop_id,
        version=shop.products_order_version,
        sort_map={str(k): int(v) for k, v in payload.sort_map.items()},
        changed_by=current_user.id,
        source=payload.source,
    ))
    db.commit()
    db.refresh(shop)

    return ReorderResponse(version=shop.products_order_version, updated=updated)


@router.get(
    "/{shop_id}/products/order-history",
    response_model=List[OrderHistoryEntry],
)
def list_order_history(
    shop_id: str,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_access),
):
    _get_shop_or_404(shop_id, db)
    rows = (
        db.query(ProductOrderHistory)
        .filter(ProductOrderHistory.shop_id == shop_id)
        .order_by(ProductOrderHistory.version.desc())
        .limit(limit)
        .all()
    )
    return rows


def _create_product_in_shop(
    db: Session,
    shop: Shop,
    body: ShopProductCreate,
    user_id: int,
    *,
    seed_note: str = "Initial stock",
) -> ShopProduct:
    """
    Create a ShopProduct + optional initial FIFO lot + receive movement.
    Raises HTTPException(409) if product_code exists (active) in this shop.
    Caller is responsible for committing the transaction.
    """
    if db.query(ShopProduct).filter(
        ShopProduct.shop_id == shop.id,
        ShopProduct.product_code == body.product_code,
        ShopProduct.is_active == True,
    ).first():
        raise HTTPException(status_code=409, detail="Product code already exists in this shop")

    product = ShopProduct(
        shop_id=shop.id,
        product_code=body.product_code,
        barcode=body.barcode,
        name=body.name,
        category=body.category,
        external_price=body.external_price,
        internal_price=body.internal_price if body.internal_price is not None else body.external_price,
        vat_percent=body.vat_percent,
        avg_cost=body.avg_cost,
        stock=body.stock,
        min_stock=body.min_stock,
        uom_id=body.uom_id,
    )
    db.add(product)
    db.flush()

    # Auto-register product in all existing price panels for this shop
    from app.models.price_panel import PricePanel as _PricePanel, PricePanelItem as _PricePanelItem
    existing_panels = db.query(_PricePanel).filter(_PricePanel.shop_id == shop.id).all()
    for panel in existing_panels:
        db.add(_PricePanelItem(panel_id=panel.id, product_id=product.id, price=None))

    if body.stock > 0:
        import datetime
        if shop.shop_type.value == "fifo":
            db.add(FifoLot(
                id=f"init-{product.id}",
                product_id=product.id,
                shop_id=shop.id,
                date=datetime.date(2026, 1, 1),
                qty_remaining=body.stock,
                cost_per_unit=body.avg_cost,
            ))
        db.add(ShopMovement(
            date=datetime.date.today(),
            product_id=product.id,
            product_name=product.name,
            shop_id=shop.id,
            type=MovementType.receive,
            quantity=body.stock,
            stock_before=0,
            stock_after=body.stock,
            cost_per_unit=body.avg_cost,
            note=seed_note,
            created_by=user_id,
        ))
    return product


@router.post("/{shop_id}/products", response_model=ShopProductResponse, status_code=201)
def create_product(
    shop_id: str,
    body: ShopProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_manager),
):
    shop = _get_shop_or_404(shop_id, db)
    product = _create_product_in_shop(db, shop, body, current_user.id)
    db.commit()
    db.refresh(product)
    return _product_to_response(product)


@router.post("/{shop_id}/products/batch", response_model=BatchImportResult)
def batch_import_products(
    shop_id: str,
    body: BatchImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_manager),
):
    """
    Bulk-create multiple products in one shop. Each row is validated + inserted
    independently — bad rows are reported in `errors[]` while good rows commit.

    Dedup within the batch: duplicate product_codes inside the same request are
    flagged on the second occurrence.
    """
    shop = _get_shop_or_404(shop_id, db)
    errors: List[BatchImportError] = []
    created_rows: List[ShopProduct] = []
    seen_codes: set[str] = set()

    for idx, item in enumerate(body.items):
        code = item.product_code.strip() if item.product_code else ""
        if code in seen_codes:
            errors.append(BatchImportError(
                row=idx, product_code=code,
                error="Duplicate product_code within this batch",
            ))
            continue
        seen_codes.add(code)
        try:
            product = _create_product_in_shop(
                db, shop, item, current_user.id, seed_note="Batch import"
            )
            created_rows.append(product)
        except HTTPException as e:
            db.rollback()
            # Re-bind shop after rollback (session may have expired attrs)
            shop = _get_shop_or_404(shop_id, db)
            errors.append(BatchImportError(
                row=idx, product_code=code, error=str(e.detail),
            ))
        except Exception as e:
            db.rollback()
            shop = _get_shop_or_404(shop_id, db)
            errors.append(BatchImportError(
                row=idx, product_code=code, error=f"{type(e).__name__}: {e}",
            ))

    db.commit()
    for p in created_rows:
        db.refresh(p)

    return BatchImportResult(
        total=len(body.items),
        created=len(created_rows),
        skipped=len(errors),
        errors=errors,
        created_products=[_product_to_response(p) for p in created_rows],
    )


@router.patch("/{shop_id}/products/{product_id}", response_model=ShopProductResponse)
def update_product(
    shop_id: str,
    product_id: int,
    body: ShopProductUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_manager),
):
    product = _get_product_or_404(product_id, shop_id, db)
    price_fields = {"external_price", "internal_price"}
    # Snapshot price fields before applying changes
    old_prices = {f: float(getattr(product, f, 0) or 0) for f in price_fields}
    # exclude_unset keeps explicit nulls (e.g. photo_url: null to clear photo)
    # while omitting fields the client didn't send.
    updates = body.model_dump(exclude_unset=True)
    for field, value in updates.items():
        # uom_id=0 means clear the UOM
        if field == "uom_id" and value == 0:
            value = None
        setattr(product, field, value)
    db.flush()
    # Log audit entry if prices changed
    new_prices = {f: float(getattr(product, f, 0) or 0) for f in price_fields}
    if any(old_prices[f] != new_prices[f] for f in price_fields):
        create_audit_log(
            db,
            entity_type="shop_product",
            entity_id=product.id,
            entity_name=product.name,
            shop_id=shop_id,
            action="UPDATE_PRICE",
            changes={"old": old_prices, "new": new_prices},
            user_id=current_user.id,
        )
    db.commit()
    db.refresh(product)
    return _product_to_response(product)


@router.delete("/{shop_id}/products/{product_id}", status_code=204)
def delete_product(
    shop_id: str,
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_manager),
):
    product = _get_product_or_404(product_id, shop_id, db)
    # Snapshot before soft-delete for audit
    snapshot = {
        "name": product.name,
        "external_price": float(product.external_price or 0),
        "internal_price": float(product.internal_price or 0),
        "stock": product.stock,
        "category": product.category,
    }
    product.is_active = False
    create_audit_log(
        db,
        entity_type="shop_product",
        entity_id=product.id,
        entity_name=product.name,
        shop_id=shop_id,
        action="DELETE_PRODUCT",
        changes={"snapshot": snapshot},
        user_id=current_user.id,
    )
    db.commit()


# ── Product / menu photo upload ───────────────────────────────────────────────

@router.post("/{shop_id}/products/{product_id}/photo", response_model=ShopProductResponse)
async def upload_product_photo_route(
    shop_id: str,
    product_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_manager),
):
    """Upload a menu/product image. Manager-level only (master-data mutation)."""
    from app.core.config import settings
    from app.services.upload_service import upload_product_photo

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large (max {settings.MAX_UPLOAD_SIZE // 1_000_000} MB)",
        )

    product = _get_product_or_404(product_id, shop_id, db)

    try:
        import io
        url = upload_product_photo(io.BytesIO(content), shop_id, product.id)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        logger.exception("Cloudinary upload failed for product %s/%s", shop_id, product_id)
        raise HTTPException(status_code=502, detail="Photo upload failed")

    product.photo_url = url
    db.commit()
    db.refresh(product)
    return _product_to_response(product)


# ── FIFO lots ─────────────────────────────────────────────────────────────────

@router.get("/{shop_id}/products/{product_id}/fifo-lots", response_model=List[FifoLotResponse])
def get_fifo_lots(
    shop_id: str,
    product_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_access),
):
    _get_shop_or_404(shop_id, db)
    lots = (
        db.query(FifoLot)
        .filter(FifoLot.product_id == product_id, FifoLot.shop_id == shop_id)
        .order_by(FifoLot.date)
        .all()
    )
    return [
        FifoLotResponse(
            id=l.id,
            product_id=l.product_id,
            date=str(l.date),
            qty_remaining=float(l.qty_remaining),
            cost_per_unit=float(l.cost_per_unit),
        )
        for l in lots
    ]


# ── Receive stock ─────────────────────────────────────────────────────────────

@router.post("/{shop_id}/receive", response_model=List[ShopProductResponse])
def receive_stock(
    shop_id: str,
    body: ReceiveStockRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_manager),
):
    """
    Receive one or more products into a shop.
    Returns the updated list of affected products.
    """
    shop = _get_shop_or_404(shop_id, db)
    updated = []
    for item in body.items:
        product = _get_product_or_404(item.product_id, shop_id, db)
        InventoryService.receive_stock(
            db=db,
            shop=shop,
            product=product,
            qty=item.qty,
            cost_per_unit=item.cost_per_unit,
            reference=item.po or item.invoice,
            note=item.note,
            user_id=current_user.id,
        )
        updated.append(product)
    db.commit()
    for p in updated:
        db.refresh(p)
    return [_product_to_response(p) for p in updated]


# ── Adjust stock ──────────────────────────────────────────────────────────────

@router.post("/{shop_id}/adjust", response_model=ShopProductResponse)
def adjust_stock(
    shop_id: str,
    body: AdjustStockRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_manager),
):
    if body.delta == 0:
        raise HTTPException(status_code=422, detail="delta cannot be 0")
    shop = _get_shop_or_404(shop_id, db)
    product = _get_product_or_404(body.product_id, shop_id, db)
    InventoryService.adjust_stock(
        db=db,
        shop=shop,
        product=product,
        delta=body.delta,
        reason=body.reason,
        cost_per_unit=body.cost_per_unit,
        user_id=current_user.id,
    )
    db.commit()
    db.refresh(product)
    return _product_to_response(product)


# ── Staff Requisition ─────────────────────────────────────────────────────────
# เบิกสินค้าโดยบุคลากรภายใน — supports three pay modes:
#   • free        → no wallet deduction, total recorded as 0 (audit-only)
#   • department  → debits the department wallet (negative allowed per project rule)
#   • wallet      → debits the requester user's personal wallet
# Internally delegates to POSService.checkout with transaction_mode=internal_issue
# so the same stock-movement / receipt audit trail is reused.

class RequisitionItemPayload(BaseModel):
    product_id: int
    qty: int = Field(ge=1)


class RequisitionPayload(BaseModel):
    items: List[RequisitionItemPayload] = Field(min_length=1)
    requester_user_id: int
    pay_mode: str = Field(pattern="^(free|department|wallet)$")
    payer_department_id: Optional[int] = None
    notes: Optional[str] = None


@router.post("/{shop_id}/requisition", response_model=ReceiptResponse, status_code=status.HTTP_201_CREATED)
def create_requisition(
    shop_id: str,
    body: RequisitionPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_shop_access),
):
    shop = _get_shop_or_404(shop_id, db)

    requester = db.query(User).filter(User.id == body.requester_user_id).first()
    if not requester:
        raise HTTPException(status_code=404, detail="Requester not found")
    if not requester.is_active:
        raise HTTPException(status_code=400, detail="Requester is not active")

    if body.pay_mode == "department":
        if not body.payer_department_id:
            raise HTTPException(status_code=422, detail="Department charge requires payer_department_id")
        if not shop.allow_department_charge:
            raise HTTPException(
                status_code=400,
                detail=f"Shop '{shop_id}' does not accept department charges",
            )

    # Build line items. Look up products to honour real catalog price unless
    # pay_mode=free (then override to 0 so wallet/department isn't charged).
    items_payload: List[dict] = []
    for line in body.items:
        product = _get_product_or_404(line.product_id, shop_id, db)
        unit_price = float(getattr(product, "internal_price", None) or product.external_price or 0)
        item_dict = {
            "product_variant_id": product.id,
            "quantity": line.qty,
            "unit_price": unit_price,
            "discount": 0,
            "options": [],
        }
        if body.pay_mode == "free":
            item_dict["price_override"] = 0
        items_payload.append(item_dict)

    if body.pay_mode == "free":
        payment_method = "cash"
        payer_kind = "user"
        payer_user_id: Optional[int] = None
        payer_department_id: Optional[int] = None
    elif body.pay_mode == "department":
        payment_method = "department"
        payer_kind = "department"
        payer_user_id = None
        payer_department_id = body.payer_department_id
    else:  # wallet
        payment_method = "wallet"
        payer_kind = "user"
        payer_user_id = body.requester_user_id
        payer_department_id = None

    try:
        receipt = POSService.checkout(
            db,
            transaction_mode="internal_issue",
            payment_method=payment_method,
            items=items_payload,
            user_id=current_user.id,
            customer_id=None,
            payer_kind=payer_kind,
            payer_user_id=payer_user_id,
            payer_department_id=payer_department_id,
            requester_user_id=body.requester_user_id,
            notes=body.notes,
            shop_id=shop_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return _receipt_to_response(receipt)


# ── Stock movements ───────────────────────────────────────────────────────────

@router.get("/{shop_id}/movements", response_model=List[ShopMovementResponse])
def list_movements(
    shop_id: str,
    product_id: Optional[int] = Query(None),
    type: Optional[MovementType] = Query(None),
    limit: int = Query(200, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_access),
):
    _get_shop_or_404(shop_id, db)
    q = db.query(ShopMovement).filter(ShopMovement.shop_id == shop_id)
    if product_id:
        q = q.filter(ShopMovement.product_id == product_id)
    if type:
        q = q.filter(ShopMovement.type == type)
    movements = q.order_by(ShopMovement.created_at.desc()).limit(limit).all()
    return [_movement_to_response(m) for m in movements]


# ── Audit logs ───────────────────────────────────────────────────────────────

@router.get("/{shop_id}/audit-logs", response_model=List[dict])
def list_audit_logs(
    shop_id: str,
    action: Optional[str] = Query(None, description="Filter by action e.g. UPDATE_PRICE"),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_access),
):
    """Return audit log entries for this shop (price changes + deletions)."""
    from sqlalchemy import text as sqlt
    _get_shop_or_404(shop_id, db)
    where_clauses = ["al.shop_id = :shop_id"]
    params: dict = {"shop_id": shop_id, "limit": limit, "offset": offset}
    if action:
        where_clauses.append("al.action = :action")
        params["action"] = action
    where_sql = " AND ".join(where_clauses)
    rows = db.execute(
        sqlt(f"""
            SELECT
                al.id, al.entity_type, al.entity_id, al.entity_name,
                al.action, al.changes_json, al.created_at,
                u.username AS user_username, u.full_name AS user_full_name
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al.user_id
            WHERE {where_sql}
            ORDER BY al.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).fetchall()
    return [
        {
            "id": r[0],
            "entity_type": r[1],
            "entity_id": r[2],
            "entity_name": r[3],
            "action": r[4],
            "changes": r[5],
            "created_at": r[6].isoformat() if r[6] else None,
            "user_username": r[7],
            "user_full_name": r[8],
        }
        for r in rows
    ]


# ── Menu option groups ────────────────────────────────────────────────────────


def _get_group_or_404(
    group_id: int, product_id: int, shop_id: str, db: Session
) -> MenuOptionGroup:
    group = (
        db.query(MenuOptionGroup)
        .join(ShopProduct, ShopProduct.id == MenuOptionGroup.product_id)
        .filter(
            MenuOptionGroup.id == group_id,
            MenuOptionGroup.product_id == product_id,
            ShopProduct.shop_id == shop_id,
        )
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Option group not found")
    return group


@router.get(
    "/{shop_id}/products/{product_id}/option-groups",
    response_model=List[MenuOptionGroupResponse],
)
def list_option_groups(
    shop_id: str,
    product_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_access),
):
    _get_product_or_404(product_id, shop_id, db)
    groups = (
        db.query(MenuOptionGroup)
        .filter(MenuOptionGroup.product_id == product_id)
        .order_by(MenuOptionGroup.sort_order, MenuOptionGroup.id)
        .all()
    )
    return groups


@router.post(
    "/{shop_id}/products/{product_id}/option-groups",
    response_model=MenuOptionGroupResponse,
    status_code=201,
)
def create_option_group(
    shop_id: str,
    product_id: int,
    body: MenuOptionGroupCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_manager),
):
    _get_product_or_404(product_id, shop_id, db)
    group = MenuOptionGroup(
        product_id=product_id,
        name=body.name.strip(),
        selection_type=body.selection_type,
        is_required=body.is_required,
        max_selections=body.max_selections,
        sort_order=body.sort_order,
    )
    for idx, opt in enumerate(body.options):
        group.options.append(
            MenuOption(
                name=opt.name.strip(),
                price_delta=opt.price_delta,
                sort_order=opt.sort_order if opt.sort_order else idx,
            )
        )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@router.patch(
    "/{shop_id}/products/{product_id}/option-groups/{group_id}",
    response_model=MenuOptionGroupResponse,
)
def update_option_group(
    shop_id: str,
    product_id: int,
    group_id: int,
    body: MenuOptionGroupUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_manager),
):
    group = _get_group_or_404(group_id, product_id, shop_id, db)

    data = body.model_dump(exclude_unset=True)
    options_payload = data.pop("options", None)
    for field, value in data.items():
        setattr(group, field, value)

    # If `options` is provided, replace the full option list for this group.
    if options_payload is not None:
        group.options.clear()
        db.flush()
        for idx, opt in enumerate(options_payload):
            group.options.append(
                MenuOption(
                    name=opt["name"].strip(),
                    price_delta=opt.get("price_delta", 0),
                    sort_order=opt.get("sort_order") or idx,
                )
            )

    db.commit()
    db.refresh(group)
    return group


@router.delete(
    "/{shop_id}/products/{product_id}/option-groups/{group_id}",
    status_code=204,
)
def delete_option_group(
    shop_id: str,
    product_id: int,
    group_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_shop_manager),
):
    group = _get_group_or_404(group_id, product_id, shop_id, db)
    db.delete(group)
    db.commit()
