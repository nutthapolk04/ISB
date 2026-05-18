"""
Bulk Import API — admin/manager endpoints for Excel and CSV import.

POST /admin/import/products      — upsert ShopProduct rows by barcode
POST /admin/import/stock-receive — receive stock via ShopMovement / InventoryService
"""
from __future__ import annotations

import csv
import io
import logging
import time
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.database import get_db
from app.models.shop import MovementType, Shop, ShopMovement, ShopProduct
from app.models.unit_of_measure import UnitOfMeasure
from app.models.user import User
from app.services.inventory_service import InventoryService

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Response schemas ──────────────────────────────────────────────────────────

class ImportError(BaseModel):
    row: int
    reason: str


class ProductImportResult(BaseModel):
    created: int
    updated: int
    errors: List[ImportError]


class StockImportResult(BaseModel):
    imported: int
    errors: List[ImportError]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_file(filename: str, content: bytes) -> list[dict]:
    """
    Parse uploaded file to list of row dicts.
    Supports .xlsx (via openpyxl) and .csv (via stdlib csv).
    """
    ext = (filename or "").rsplit(".", 1)[-1].lower()

    if ext == "xlsx":
        import openpyxl  # already in requirements.txt
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return []
        headers = [str(h).strip() if h is not None else "" for h in rows[0]]
        result = []
        for row in rows[1:]:
            result.append({headers[i]: (row[i] if i < len(row) else None) for i in range(len(headers))})
        return result

    elif ext == "csv":
        text = content.decode("utf-8-sig")  # strip BOM if present
        reader = csv.DictReader(io.StringIO(text))
        return [dict(row) for row in reader]

    else:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload a .xlsx or .csv file.",
        )


def _str(val) -> str:
    """Coerce cell value to stripped string, empty string if None."""
    if val is None:
        return ""
    return str(val).strip()


def _float_or_none(val) -> Optional[float]:
    s = _str(val)
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _int_or_none(val) -> Optional[int]:
    f = _float_or_none(val)
    return int(f) if f is not None else None


# ── POST /admin/import/products ───────────────────────────────────────────────

@router.post("/products", response_model=ProductImportResult)
async def import_products(
    file: UploadFile = File(...),
    shop_id: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Bulk upsert ShopProduct rows from an Excel or CSV file.

    Required columns : name, barcode, price (retail / external_price),
                       cost_price (internal_price)
    Optional columns : category, uom, shop_id (ignored when shop_id query param
                       is provided)

    Logic: find existing ShopProduct by barcode + shop_id → update;
           not found → create (product_code auto-generated).

    shop_id must be supplied either as a query parameter or as a column in the
    file. Rows missing shop_id are skipped with an error.
    """
    content = await file.read()
    filename = file.filename or ""

    try:
        rows = _parse_file(filename, content)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {exc}") from exc

    created = 0
    updated = 0
    errors: List[ImportError] = []

    for idx, row in enumerate(rows, start=2):  # row 1 = header
        # ── Resolve shop_id ──
        row_shop_id = _str(row.get("shop_id")) or shop_id
        if not row_shop_id:
            errors.append(ImportError(row=idx, reason="shop_id is required (pass as query param or column)"))
            continue

        shop = db.query(Shop).filter(Shop.id == row_shop_id).first()
        if not shop:
            errors.append(ImportError(row=idx, reason=f"shop '{row_shop_id}' not found"))
            continue

        # ── Required fields ──
        name = _str(row.get("name"))
        barcode = _str(row.get("barcode"))
        price_val = _float_or_none(row.get("price"))
        cost_val = _float_or_none(row.get("cost_price"))

        if not name:
            errors.append(ImportError(row=idx, reason="'name' is required"))
            continue
        if price_val is None:
            errors.append(ImportError(row=idx, reason="'price' must be a valid number"))
            continue
        if cost_val is None:
            errors.append(ImportError(row=idx, reason="'cost_price' must be a valid number"))
            continue

        # ── Optional fields ──
        category = _str(row.get("category")) or "ทั่วไป"
        uom_name = _str(row.get("uom"))
        uom_id: Optional[int] = None
        if uom_name:
            uom = db.query(UnitOfMeasure).filter(
                UnitOfMeasure.name == uom_name,
                UnitOfMeasure.is_active == True,
            ).first()
            if uom:
                uom_id = uom.id

        try:
            if barcode:
                existing = db.query(ShopProduct).filter(
                    ShopProduct.shop_id == row_shop_id,
                    ShopProduct.barcode == barcode,
                ).first()
            else:
                existing = None

            if existing:
                existing.name = name
                existing.external_price = price_val
                existing.internal_price = cost_val
                existing.category = category
                if uom_id is not None:
                    existing.uom_id = uom_id
                updated += 1
            else:
                # Auto-generate product_code
                ts_suffix = int(time.time() * 1000) % 100_000_000
                product_code = f"IMP-{ts_suffix:08d}"
                product = ShopProduct(
                    shop_id=row_shop_id,
                    product_code=product_code,
                    barcode=barcode or None,
                    name=name,
                    category=category,
                    external_price=price_val,
                    internal_price=cost_val,
                    uom_id=uom_id,
                    stock=0,
                )
                db.add(product)
                created += 1

            db.flush()

        except Exception as exc:
            db.rollback()
            logger.warning("import_products row %d error: %s", idx, exc)
            errors.append(ImportError(row=idx, reason=str(exc)))

    db.commit()
    return ProductImportResult(created=created, updated=updated, errors=errors)


# ── POST /admin/import/stock-receive ─────────────────────────────────────────

@router.post("/stock-receive", response_model=StockImportResult)
async def import_stock_receive(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """
    Bulk stock receive from an Excel or CSV file.

    Required columns : shop_id, quantity
                       product_id  (ShopProduct.id)  OR  barcode
    Optional columns : cost_per_unit, notes, reference

    For each row: lookup ShopProduct → call InventoryService.receive_stock.
    """
    content = await file.read()
    filename = file.filename or ""

    try:
        rows = _parse_file(filename, content)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {exc}") from exc

    imported = 0
    errors: List[ImportError] = []

    for idx, row in enumerate(rows, start=2):
        # ── shop_id ──
        row_shop_id = _str(row.get("shop_id"))
        if not row_shop_id:
            errors.append(ImportError(row=idx, reason="'shop_id' is required"))
            continue

        shop = db.query(Shop).filter(Shop.id == row_shop_id).first()
        if not shop:
            errors.append(ImportError(row=idx, reason=f"shop '{row_shop_id}' not found"))
            continue

        # ── quantity ──
        qty = _int_or_none(row.get("quantity"))
        if qty is None or qty <= 0:
            errors.append(ImportError(row=idx, reason="'quantity' must be a positive integer"))
            continue

        # ── lookup product ──
        product: Optional[ShopProduct] = None
        pid_raw = _str(row.get("product_id"))
        barcode_raw = _str(row.get("barcode"))

        if pid_raw:
            pid = _int_or_none(pid_raw)
            if pid is not None:
                product = db.query(ShopProduct).filter(
                    ShopProduct.id == pid,
                    ShopProduct.shop_id == row_shop_id,
                ).first()
        if product is None and barcode_raw:
            product = db.query(ShopProduct).filter(
                ShopProduct.barcode == barcode_raw,
                ShopProduct.shop_id == row_shop_id,
            ).first()

        if product is None:
            errors.append(ImportError(row=idx, reason="product not found — supply valid product_id or barcode"))
            continue

        # ── optional fields ──
        cost_per_unit = _float_or_none(row.get("cost_per_unit")) or float(product.internal_price or 0)
        notes = _str(row.get("notes")) or None
        reference = _str(row.get("reference")) or None

        try:
            InventoryService.receive_stock(
                db=db,
                shop=shop,
                product=product,
                qty=qty,
                cost_per_unit=cost_per_unit,
                reference=reference,
                note=notes,
                user_id=current_user.id,
            )
            db.flush()
            imported += 1

        except Exception as exc:
            db.rollback()
            logger.warning("import_stock_receive row %d error: %s", idx, exc)
            errors.append(ImportError(row=idx, reason=str(exc)))

    db.commit()
    return StockImportResult(imported=imported, errors=errors)
