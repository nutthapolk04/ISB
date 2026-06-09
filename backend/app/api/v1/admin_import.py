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

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
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

def _parse_file(filename: str, content: bytes, preferred_sheet: Optional[str] = None) -> list[dict]:
    """
    Parse uploaded file to list of row dicts.
    Supports .xlsx (via openpyxl) and .csv (via stdlib csv).

    When `preferred_sheet` is provided and the workbook contains a sheet by
    that name, that sheet is used. Otherwise falls back to the active sheet.
    Lets one xlsx ship two import targets (Products + StockReceive) without
    forcing the operator to delete or reorder sheets before upload.
    """
    ext = (filename or "").rsplit(".", 1)[-1].lower()

    if ext == "xlsx":
        import openpyxl  # already in requirements.txt
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
        if preferred_sheet and preferred_sheet in wb.sheetnames:
            ws = wb[preferred_sheet]
        else:
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
    dry_run: bool = Query(False, description="Validate only — roll back instead of committing."),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
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

    Managers may only import into their own shop_id. Admins may import into
    any shop.

    When dry_run=true the transaction is rolled back at the end so callers
    can preview the create/update/error counts without persisting changes.
    """
    is_manager = any(r.name == "manager" for r in current_user.roles) and not any(
        r.name == "admin" for r in current_user.roles
    )
    if is_manager:
        if not current_user.shop_id:
            raise HTTPException(status_code=403, detail="Manager has no shop assignment")
        # Pin shop_id to the manager's own shop regardless of what was passed.
        if shop_id and shop_id != current_user.shop_id:
            raise HTTPException(
                status_code=403,
                detail="Manager can only import into their own shop",
            )
        shop_id = current_user.shop_id

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

        # Managers cannot cross-shop import via the file column either.
        if is_manager and row_shop_id != current_user.shop_id:
            errors.append(ImportError(row=idx, reason="Manager can only import into their own shop"))
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

    if dry_run:
        db.rollback()
    else:
        db.commit()
    return ProductImportResult(created=created, updated=updated, errors=errors)


# ── POST /admin/import/stock-receive ─────────────────────────────────────────

@router.post("/stock-receive", response_model=StockImportResult)
async def import_stock_receive(
    file: UploadFile = File(...),
    dry_run: bool = Query(False, description="Validate only — roll back instead of committing."),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """
    Bulk stock receive from an Excel or CSV file.

    Required columns : shop_id, quantity
                       product_id  (ShopProduct.id)  OR  barcode
    Optional columns : cost_per_unit, notes, reference

    For each row: lookup ShopProduct → call InventoryService.receive_stock.

    When dry_run=true the transaction is rolled back at the end so callers
    can preview the import without writing any stock movements.
    """
    is_manager = any(r.name == "manager" for r in current_user.roles) and not any(
        r.name == "admin" for r in current_user.roles
    )
    if is_manager and not current_user.shop_id:
        raise HTTPException(status_code=403, detail="Manager has no shop assignment")

    content = await file.read()
    filename = file.filename or ""

    try:
        rows = _parse_file(filename, content, preferred_sheet="StockReceive")
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

        if is_manager and row_shop_id != current_user.shop_id:
            errors.append(ImportError(row=idx, reason="Manager can only receive stock for their own shop"))
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

    if dry_run:
        db.rollback()
    else:
        db.commit()
    return StockImportResult(imported=imported, errors=errors)


# ── Template download ────────────────────────────────────────────────────────

_XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


def _write_template_sheet(ws, headers: list[str], sample_rows: list[list]) -> None:
    """Populate `ws` with a styled header row + sample data rows."""
    from openpyxl.styles import Alignment, Font, PatternFill

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="1F2937")
    center = Alignment(horizontal="center", vertical="center")

    for col_idx, header in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center
        ws.column_dimensions[cell.column_letter].width = max(14, len(header) + 4)

    for row_offset, row in enumerate(sample_rows, start=2):
        for col_idx, val in enumerate(row, start=1):
            ws.cell(row=row_offset, column=col_idx, value=val)

    ws.freeze_panes = "A2"


@router.get("/template")
def download_import_template(
    shop_id: str = "",
    current_user: User = Depends(require_role("admin", "manager")),
    db: Session = Depends(get_db),
):
    """Download a single workbook containing both import templates.

    Sheet 1 ("Products")       — columns expected by POST /admin/import/products
    Sheet 2 ("StockReceive")   — columns expected by POST /admin/import/stock-receive

    When a shop_id query param is supplied the sample rows are tailored to the
    shop's module (canteen → food samples, store → book/stationery samples) so
    operators get a relevant starting point instead of having to translate
    bookstore examples to their own domain.
    """
    import openpyxl

    # Resolve shop → module so we can pick relevant sample rows. Fall back to
    # bookstore samples when no shop_id is provided or the shop isn't found.
    module = "store"
    sample_shop_id = "bookstore"
    if shop_id:
        shop = db.query(Shop).filter(Shop.id == shop_id).first()
        if shop:
            module = (shop.module or "store").lower()
            sample_shop_id = shop.id

    if module == "canteen":
        products_samples = [
            ["ข้าวกะเพราหมูสับ", "CT001001", 45, 28, "อาหารจานหลัก", "จาน", sample_shop_id],
            ["น้ำส้มคั้น", "CT001002", 20, 10, "เครื่องดื่ม", "แก้ว", sample_shop_id],
        ]
        stock_samples = [
            [sample_shop_id, "CT001001", 50, 28, "รับเข้าจากครัวกลาง", "KIT-2026-001"],
            [sample_shop_id, "CT001002", 100, 10, "รับเข้าประจำวัน", "KIT-2026-002"],
        ]
    else:
        products_samples = [
            ["หนังสือคณิตศาสตร์ ม.1", "BK001001", 120, 70, "หนังสือเรียน", "เล่ม", sample_shop_id],
            ["สมุดบันทึก A4 80 แผ่น", "BK001002", 35, 20, "เครื่องเขียน", "เล่ม", sample_shop_id],
        ]
        stock_samples = [
            [sample_shop_id, "BK001001", 50, 65, "รับเข้าจาก supplier A", "PO-2026-001"],
            [sample_shop_id, "BK001002", 100, 18, "รับเข้าประจำเดือน", "PO-2026-002"],
        ]

    wb = openpyxl.Workbook()

    products_sheet = wb.active
    products_sheet.title = "Products"
    _write_template_sheet(
        products_sheet,
        ["name", "barcode", "price", "cost_price", "category", "uom", "shop_id"],
        products_samples,
    )

    stock_sheet = wb.create_sheet(title="StockReceive")
    _write_template_sheet(
        stock_sheet,
        ["shop_id", "barcode", "quantity", "cost_per_unit", "notes", "reference"],
        stock_samples,
    )

    buf = io.BytesIO()
    wb.save(buf)

    return Response(
        content=buf.getvalue(),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="import_template.xlsx"'},
    )
