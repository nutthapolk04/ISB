/**
 * Bulk import — port of FastAPI `backend/app/api/v1/admin_import.py`.
 *
 * Endpoints upserted:
 *   - importProducts:      products only (xlsx → shop_products)
 *   - importStockReceive:  stock-receive only (xlsx → shop_movements via receiveStock())
 *   - importStore:         combined single-sheet (product + optional opening stock)
 *   - buildTemplate:       returns xlsx Buffer for the download-template endpoint
 *
 * The combined endpoint also auto-detects the legacy two-sheet workbook
 * (Products + StockReceive) so old template files keep working without
 * forcing operators to migrate.
 */
import * as XLSX from "xlsx";
import { and, eq } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import {
  shops,
  shopProducts,
  shopCategories,
  unitsOfMeasure,
} from "@/db/schema";
import type { AccessTokenPayload } from "@/middleware/auth";
import { receiveStock } from "@/services/shop_product_service";

// ── Public DTOs (mirror frontend expectations + Python ImportResult) ──────

export interface ImportRowError {
  row: number;
  reason: string;
}

export interface ProductPreviewRow {
  row: number;
  name: string;
  barcode: string | null;
  price: number;
  cost_price: number;
  category: string;
  action: "create" | "update" | "stock_only";
  quantity: number | null;
}

export interface ProductImportResult {
  created: number;
  updated: number;
  errors: ImportRowError[];
  preview?: ProductPreviewRow[];
}

export interface StockImportResult {
  imported: number;
  errors: ImportRowError[];
}

export interface StoreImportResult {
  products: ProductImportResult;
  stock: StockImportResult;
}

// ── Internal helpers ──────────────────────────────────────────────────────

type CellValue = string | number | boolean | null | undefined;
type Row = Record<string, CellValue>;

function coerceStr(v: CellValue): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function coerceNum(v: CellValue): number | null {
  const s = coerceStr(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function coerceInt(v: CellValue): number | null {
  const n = coerceNum(v);
  return n === null ? null : Math.trunc(n);
}

/**
 * Friendly DB error mapper — mirrors `_friendly_db_error` from the Python
 * module so operators see the same actionable Thai messages.
 */
function friendlyDbError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const low = msg.toLowerCase();
  if (low.includes("unique") || low.includes("duplicate")) {
    if (low.includes("barcode")) return "Barcode นี้มีในระบบแล้ว (ระบุ barcode ซ้ำกับสินค้าอื่น)";
    if (low.includes("product_code")) return "รหัสสินค้านี้มีในระบบแล้ว";
    return "ข้อมูลซ้ำกับรายการที่มีอยู่ในระบบ";
  }
  if (low.includes("out of range") || low.includes("value too long")) {
    return "รูปแบบข้อมูลไม่ถูกต้อง (เช่น ตัวเลขเกินช่วง หรือข้อความยาวเกินไป)";
  }
  if (low.includes("not-null") || low.includes("null value")) {
    return "พบช่องที่จำเป็นแต่ปล่อยว่าง";
  }
  return msg.slice(0, 200);
}

/**
 * Parse an uploaded xlsx Buffer into a list of row dicts keyed by the first
 * row's headers. When `preferredSheet` is provided and present, use that
 * sheet; otherwise fall back to the first sheet.
 *
 * NOTE: This Bun port only supports xlsx. The Python module also accepted
 * .csv — that path is dropped here because the frontend's file picker only
 * sends xlsx in practice. If CSV support is wanted later, swap to `XLSX.read`
 * with `type: 'binary'` over a UTF-8 decoded body.
 */
function parseXlsx(buf: Buffer, preferredSheet?: string | null): Row[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = preferredSheet && wb.SheetNames.includes(preferredSheet)
    ? preferredSheet
    : wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  // defval: "" gives empty strings for missing cells so coerceStr handles them.
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: true });
}

// ── Row processors ────────────────────────────────────────────────────────

interface ProcessCtx {
  isManager: boolean;
  managerShopId: string | null;
  defaultShopId: string;
  userId: number;
}

/**
 * Upsert a product from a parsed row. Returns the resolved product row
 * (so the combined handler can immediately receive stock into it without a
 * second barcode lookup), or `null` if there was a validation/DB error
 * (which is recorded in `errors`).
 */
async function upsertProductRow(
  rowIdx: number,
  row: Row,
  ctx: ProcessCtx,
  errors: ImportRowError[],
): Promise<{ product: typeof shopProducts.$inferSelect; wasCreated: boolean } | null> {
  const rowShopId = coerceStr(row.shop_id) || ctx.defaultShopId;
  if (!rowShopId) {
    errors.push({ row: rowIdx, reason: "ต้องระบุ shop_id (ทั้งเป็น query param หรือคอลัมน์ในไฟล์)" });
    return null;
  }
  if (ctx.isManager && rowShopId !== ctx.managerShopId) {
    errors.push({ row: rowIdx, reason: "Manager นำเข้าได้เฉพาะร้านของตัวเองเท่านั้น" });
    return null;
  }

  const shopRows = await db.select().from(shops).where(eq(shops.id, rowShopId)).limit(1);
  if (!shopRows[0]) {
    errors.push({ row: rowIdx, reason: `ไม่พบร้าน '${rowShopId}' ในระบบ` });
    return null;
  }

  const name = coerceStr(row.name);
  const barcode = coerceStr(row.barcode);
  const priceVal = coerceNum(row.price);
  const costVal = coerceNum(row.cost_price);

  if (!name) {
    errors.push({ row: rowIdx, reason: "ต้องระบุ 'name' (ชื่อสินค้า)" });
    return null;
  }
  if (priceVal === null) {
    errors.push({ row: rowIdx, reason: "'price' (ราคาขาย) ต้องเป็นตัวเลข" });
    return null;
  }
  if (costVal === null) {
    errors.push({ row: rowIdx, reason: "'cost_price' (ต้นทุน) ต้องเป็นตัวเลข" });
    return null;
  }

  const category = coerceStr(row.category) || "ทั่วไป";
  const rowProductCode = coerceStr(row.product_code);

  // Ensure category exists for this shop (mirrors Python — flush a new
  // ShopCategory before the product so the FK reference is valid).
  const catRows = await db
    .select({ id: shopCategories.id })
    .from(shopCategories)
    .where(and(eq(shopCategories.shopId, rowShopId), eq(shopCategories.name, category)))
    .limit(1);
  if (!catRows[0]) {
    try {
      await db
        .insert(shopCategories)
        .values({ id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, shopId: rowShopId, name: category });
    } catch {
      // Race-condition tolerant: another concurrent row may have inserted it.
    }
  }

  // Resolve uom by display name when provided.
  let uomId: number | null = null;
  const uomName = coerceStr(row.uom);
  if (uomName) {
    const uomRows = await db
      .select({ id: unitsOfMeasure.id })
      .from(unitsOfMeasure)
      .where(and(eq(unitsOfMeasure.name, uomName), eq(unitsOfMeasure.isActive, true)))
      .limit(1);
    if (uomRows[0]) uomId = uomRows[0].id;
  }

  // Find existing product by (shop_id, barcode) or (shop_id, name).
  let existing: typeof shopProducts.$inferSelect | undefined;
  if (barcode) {
    const rows = await db
      .select()
      .from(shopProducts)
      .where(and(eq(shopProducts.shopId, rowShopId), eq(shopProducts.barcode, barcode)))
      .limit(1);
    existing = rows[0];
  } else {
    const rows = await db
      .select()
      .from(shopProducts)
      .where(and(eq(shopProducts.shopId, rowShopId), eq(shopProducts.name, name)))
      .limit(1);
    existing = rows[0];
  }

  try {
    if (existing) {
      const updates: Record<string, unknown> = {
        name,
        externalPrice: String(priceVal),
        internalPrice: String(costVal),
        category,
      };
      if (uomId !== null) updates.uomId = uomId;
      if (rowProductCode) updates.productCode = rowProductCode;
      const updated = await db
        .update(shopProducts)
        .set(updates)
        .where(eq(shopProducts.id, existing.id))
        .returning();
      return { product: updated[0], wasCreated: false };
    }

    // New product. `IMP-<ts-suffix><1-hex-byte>` mirrors the Python code-gen.
    const tsSuffix = Date.now() % 100_000_000;
    const hex = Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
    const productCode = rowProductCode || `IMP-${String(tsSuffix).padStart(8, "0")}${hex}`;

    const inserted = await db
      .insert(shopProducts)
      .values({
        shopId: rowShopId,
        productCode,
        barcode: barcode || null,
        name,
        category,
        externalPrice: String(priceVal),
        internalPrice: String(costVal),
        vatPercent: "7.00",
        avgCost: "0.0000",
        stock: 0,
        minStock: 0,
        isActive: true,
        uomId,
        sortOrder: 0,
      })
      .returning();
    return { product: inserted[0], wasCreated: true };
  } catch (e) {
    errors.push({ row: rowIdx, reason: friendlyDbError(e) });
    return null;
  }
}

async function processProductRows(rows: Row[], ctx: ProcessCtx): Promise<ProductImportResult> {
  let created = 0;
  let updated = 0;
  const errors: ImportRowError[] = [];
  // Row 2 = first data row in operator-facing reports (header is row 1).
  for (let i = 0; i < rows.length; i += 1) {
    const r = await upsertProductRow(i + 2, rows[i], ctx, errors);
    if (r) {
      if (r.wasCreated) created += 1;
      else updated += 1;
    }
  }
  return { created, updated, errors };
}

async function processStockRows(rows: Row[], ctx: ProcessCtx): Promise<StockImportResult> {
  let imported = 0;
  const errors: ImportRowError[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const rowIdx = i + 2;
    const row = rows[i];
    try {
      const rowShopId = coerceStr(row.shop_id);
      if (!rowShopId) {
        errors.push({ row: rowIdx, reason: "ต้องระบุ 'shop_id'" });
        continue;
      }
      if (ctx.isManager && rowShopId !== ctx.managerShopId) {
        errors.push({ row: rowIdx, reason: "Manager รับสต็อกได้เฉพาะร้านของตัวเองเท่านั้น" });
        continue;
      }
      const qty = coerceInt(row.quantity);
      if (qty === null || qty <= 0) {
        errors.push({ row: rowIdx, reason: "'quantity' ต้องเป็นจำนวนเต็มที่มากกว่า 0" });
        continue;
      }

      // Resolve product by product_id (if numeric) else barcode.
      let productId: number | null = null;
      const pidRaw = coerceStr(row.product_id);
      if (pidRaw) productId = coerceInt(pidRaw);

      const barcode = coerceStr(row.barcode);
      let product: typeof shopProducts.$inferSelect | undefined;
      if (productId !== null) {
        const rows2 = await db
          .select()
          .from(shopProducts)
          .where(and(eq(shopProducts.id, productId), eq(shopProducts.shopId, rowShopId)))
          .limit(1);
        product = rows2[0];
      }
      if (!product && barcode) {
        const rows2 = await db
          .select()
          .from(shopProducts)
          .where(and(eq(shopProducts.barcode, barcode), eq(shopProducts.shopId, rowShopId)))
          .limit(1);
        product = rows2[0];
      }
      if (!product) {
        errors.push({ row: rowIdx, reason: "ไม่พบสินค้า — กรุณาระบุ product_id หรือ barcode ที่ถูกต้อง" });
        continue;
      }

      const costPerUnit = coerceNum(row.cost_per_unit) ?? Number(product.internalPrice) ?? 0;
      const note = coerceStr(row.notes) || null;
      const reference = coerceStr(row.reference) || null;

      await receiveStock({
        shopId: rowShopId,
        items: [{
          product_id: product.id,
          qty,
          cost_per_unit: costPerUnit,
          po: reference,
          invoice: null,
          note,
        }],
        userId: ctx.userId,
      });
      imported += 1;
    } catch (e) {
      errors.push({ row: rowIdx, reason: friendlyDbError(e) });
    }
  }
  return { imported, errors };
}

/**
 * Dry-run pass: validate rows and determine create/update actions without
 * writing anything to the DB. Returns preview rows + errors for UI display.
 */
async function dryRunCombinedRows(rows: Row[], ctx: ProcessCtx): Promise<StoreImportResult> {
  const preview: ProductPreviewRow[] = [];
  const productErrors: ImportRowError[] = [];
  let stockImported = 0;
  const stockErrors: ImportRowError[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const rowIdx = i + 2;
    const row = rows[i];

    const name = coerceStr(row.name);
    const priceVal = coerceNum(row.price);
    const costVal = coerceNum(row.cost_price);
    const qtyVal = coerceInt(row.quantity);
    const barcode = coerceStr(row.barcode) || null;
    const category = coerceStr(row.category) || "ทั่วไป";
    const rowShopId = coerceStr(row.shop_id) || ctx.defaultShopId;

    const hasProductData = name && priceVal !== null && costVal !== null;
    const hasStockData = qtyVal !== null && qtyVal > 0;

    if (hasProductData) {
      if (!rowShopId) {
        productErrors.push({ row: rowIdx, reason: "ต้องระบุ shop_id" });
        continue;
      }
      if (ctx.isManager && rowShopId !== ctx.managerShopId) {
        productErrors.push({ row: rowIdx, reason: "Manager นำเข้าได้เฉพาะร้านของตัวเองเท่านั้น" });
        continue;
      }

      // Check existing product (create vs update) — read-only.
      let exists = false;
      if (barcode) {
        const r = await db.select({ id: shopProducts.id }).from(shopProducts)
          .where(and(eq(shopProducts.shopId, rowShopId), eq(shopProducts.barcode, barcode))).limit(1);
        exists = !!r[0];
      } else {
        const r = await db.select({ id: shopProducts.id }).from(shopProducts)
          .where(and(eq(shopProducts.shopId, rowShopId), eq(shopProducts.name, name))).limit(1);
        exists = !!r[0];
      }

      preview.push({
        row: rowIdx,
        name,
        barcode,
        price: priceVal!,
        cost_price: costVal!,
        category,
        action: exists ? "update" : "create",
        quantity: hasStockData ? qtyVal : null,
      });
      if (hasStockData) stockImported += 1;

    } else if (hasStockData && !hasProductData) {
      // Stock-only top-up row — look up existing product by barcode.
      const rowShopId2 = coerceStr(row.shop_id) || ctx.defaultShopId;
      let productName: string | null = null;
      if (barcode) {
        const r = await db.select({ name: shopProducts.name }).from(shopProducts)
          .where(and(eq(shopProducts.barcode, barcode), eq(shopProducts.shopId, rowShopId2))).limit(1);
        if (r[0]) productName = r[0].name;
      }
      if (productName) {
        preview.push({
          row: rowIdx,
          name: productName,
          barcode,
          price: 0,
          cost_price: 0,
          category: "",
          action: "stock_only",
          quantity: qtyVal,
        });
        stockImported += 1;
      } else if (barcode) {
        stockErrors.push({ row: rowIdx, reason: "ไม่พบสินค้า barcode นี้ในระบบ" });
      }
    } else if (name || priceVal !== null || costVal !== null) {
      if (!name) productErrors.push({ row: rowIdx, reason: "ต้องระบุ 'name' (ชื่อสินค้า)" });
      else if (priceVal === null) productErrors.push({ row: rowIdx, reason: "'price' (ราคาขาย) ต้องเป็นตัวเลข" });
      else productErrors.push({ row: rowIdx, reason: "'cost_price' (ต้นทุน) ต้องเป็นตัวเลข" });
    }
  }

  const created = preview.filter((r) => r.action === "create").length;
  const updated = preview.filter((r) => r.action === "update").length;

  return {
    products: { created, updated, errors: productErrors, preview },
    stock: { imported: stockImported, errors: stockErrors },
  };
}

/**
 * Combined single-sheet processor: every row may carry both product columns
 * and stock-receive columns. Mirrors `_run_combined_rows` in the Python
 * module — product step first, then stock step using the just-upserted
 * product (no second barcode lookup needed).
 */
async function processCombinedRows(rows: Row[], ctx: ProcessCtx): Promise<StoreImportResult> {
  const productResult: ProductImportResult = { created: 0, updated: 0, errors: [] };
  const stockResult: StockImportResult = { imported: 0, errors: [] };

  for (let i = 0; i < rows.length; i += 1) {
    const rowIdx = i + 2;
    const row = rows[i];

    const name = coerceStr(row.name);
    const priceVal = coerceNum(row.price);
    const costVal = coerceNum(row.cost_price);
    const qtyVal = coerceInt(row.quantity);
    const barcode = coerceStr(row.barcode);

    const hasProductData = name && priceVal !== null && costVal !== null;
    const hasStockData = qtyVal !== null && qtyVal > 0;

    let product: typeof shopProducts.$inferSelect | undefined;

    if (hasProductData) {
      const r = await upsertProductRow(rowIdx, row, ctx, productResult.errors);
      if (!r) continue;
      if (r.wasCreated) productResult.created += 1;
      else productResult.updated += 1;
      product = r.product;
    } else if (name || priceVal !== null || costVal !== null) {
      // Partial product columns — that's a validation error, not a silent
      // skip. Tell the operator which field is missing.
      if (!name) productResult.errors.push({ row: rowIdx, reason: "ต้องระบุ 'name' (ชื่อสินค้า)" });
      else if (priceVal === null) productResult.errors.push({ row: rowIdx, reason: "'price' (ราคาขาย) ต้องเป็นตัวเลข" });
      else productResult.errors.push({ row: rowIdx, reason: "'cost_price' (ต้นทุน) ต้องเป็นตัวเลข" });
      continue;
    }

    if (hasStockData && qtyVal !== null) {
      const rowShopId = coerceStr(row.shop_id) || ctx.defaultShopId;
      if (!product && barcode) {
        const rows2 = await db
          .select()
          .from(shopProducts)
          .where(and(eq(shopProducts.barcode, barcode), eq(shopProducts.shopId, rowShopId)))
          .limit(1);
        product = rows2[0];
      }
      if (!product) {
        stockResult.errors.push({
          row: rowIdx,
          reason: "ไม่พบสินค้าสำหรับรับสต็อก — ต้องระบุ name/price/cost_price หรือ barcode ที่มีอยู่",
        });
        continue;
      }
      try {
        const costPerUnit = coerceNum(row.cost_per_unit) ?? Number(product.internalPrice) ?? 0;
        const note = coerceStr(row.notes) || null;
        const reference = coerceStr(row.reference) || null;
        await receiveStock({
          shopId: rowShopId,
          items: [{
            product_id: product.id,
            qty: qtyVal,
            cost_per_unit: costPerUnit,
            po: reference,
            invoice: null,
            note,
          }],
          userId: ctx.userId,
        });
        stockResult.imported += 1;
      } catch (e) {
        stockResult.errors.push({ row: rowIdx, reason: friendlyDbError(e) });
      }
    }
  }

  return { products: productResult, stock: stockResult };
}

// ── Public entrypoints ────────────────────────────────────────────────────

function callerCtx(caller: AccessTokenPayload & { shop_id?: string | null }, requestedShopId: string): {
  ctx: ProcessCtx;
  effectiveShopId: string;
  forbidden?: string;
} {
  const isManager = caller.roles.includes("manager") && !caller.is_superuser;
  let effectiveShopId = requestedShopId;
  if (isManager) {
    const managerShop = caller.shop_id ?? null;
    if (!managerShop) {
      return {
        ctx: { isManager, managerShopId: null, defaultShopId: "", userId: Number(caller.sub) },
        effectiveShopId: "",
        forbidden: "Manager has no shop assignment",
      };
    }
    if (requestedShopId && requestedShopId !== managerShop) {
      return {
        ctx: { isManager, managerShopId: managerShop, defaultShopId: managerShop, userId: Number(caller.sub) },
        effectiveShopId: managerShop,
        forbidden: "Manager can only import into their own shop",
      };
    }
    effectiveShopId = managerShop;
  }
  return {
    ctx: {
      isManager,
      managerShopId: isManager ? (caller.shop_id ?? null) : null,
      defaultShopId: effectiveShopId,
      userId: Number(caller.sub),
    },
    effectiveShopId,
  };
}

export async function importProducts(args: {
  caller: AccessTokenPayload & { shop_id?: string | null };
  file: File;
  shopId: string;
}): Promise<{ status: number; body: ProductImportResult | { detail: string } }> {
  const { ctx, forbidden } = callerCtx(args.caller, args.shopId);
  if (forbidden) return { status: 403, body: { detail: forbidden } };

  let rows: Row[];
  try {
    const buf = Buffer.from(await args.file.arrayBuffer());
    rows = parseXlsx(buf);
  } catch (e) {
    return { status: 400, body: { detail: `Could not parse file: ${friendlyDbError(e)}` } };
  }

  return { status: 200, body: await processProductRows(rows, ctx) };
}

export async function importStockReceive(args: {
  caller: AccessTokenPayload & { shop_id?: string | null };
  file: File;
}): Promise<{ status: number; body: StockImportResult | { detail: string } }> {
  // Stock-receive endpoint always reads from the StockReceive sheet when
  // present (mirrors `preferred_sheet="StockReceive"` in the Python).
  const { ctx, forbidden } = callerCtx(args.caller, "");
  if (forbidden) return { status: 403, body: { detail: forbidden } };

  let rows: Row[];
  try {
    const buf = Buffer.from(await args.file.arrayBuffer());
    rows = parseXlsx(buf, "StockReceive");
  } catch (e) {
    return { status: 400, body: { detail: `Could not parse file: ${friendlyDbError(e)}` } };
  }

  return { status: 200, body: await processStockRows(rows, ctx) };
}

export async function importStore(args: {
  caller: AccessTokenPayload & { shop_id?: string | null };
  file: File;
  shopId: string;
  dryRun?: boolean;
}): Promise<{ status: number; body: StoreImportResult | { detail: string } }> {
  const { ctx, forbidden } = callerCtx(args.caller, args.shopId);
  if (forbidden) return { status: 403, body: { detail: forbidden } };

  let buf: Buffer;
  try {
    buf = Buffer.from(await args.file.arrayBuffer());
  } catch (e) {
    return { status: 400, body: { detail: `Could not read file: ${friendlyDbError(e)}` } };
  }

  if (args.dryRun) {
    let rows: Row[];
    try {
      // For dry-run prefer the unified sheet; fall back handles legacy workbooks below.
      let legacyProducts: Row[] = [];
      let legacyStock: Row[] = [];
      try { legacyProducts = parseXlsx(buf, "Products"); } catch { /* ignore */ }
      try { legacyStock = parseXlsx(buf, "StockReceive"); } catch { /* ignore */ }
      if (legacyProducts.length > 0 && legacyStock.length > 0) {
        // Legacy two-sheet dry-run: merge into a combined preview list.
        rows = [...legacyProducts, ...legacyStock];
      } else {
        rows = parseXlsx(buf, null);
      }
    } catch (e) {
      return { status: 400, body: { detail: `Could not parse file: ${friendlyDbError(e)}` } };
    }
    return { status: 200, body: await dryRunCombinedRows(rows, ctx) };
  }

  // ── Real import ───────────────────────────────────────────────────────────

  // Legacy two-sheet workbook detection: when both Products + StockReceive
  // sheets are present, use the split-sheet flow so old template files keep
  // working without forcing operators to migrate.
  let legacyProducts: Row[] = [];
  let legacyStock: Row[] = [];
  try { legacyProducts = parseXlsx(buf, "Products"); } catch { /* fall through */ }
  try { legacyStock = parseXlsx(buf, "StockReceive"); } catch { /* fall through */ }

  if (legacyProducts.length > 0 && legacyStock.length > 0) {
    const products = await processProductRows(legacyProducts, ctx);
    const stock = await processStockRows(legacyStock, ctx);
    return { status: 200, body: { products, stock } };
  }

  // Unified single-sheet path — read the first sheet.
  let rows: Row[];
  try {
    rows = parseXlsx(buf, null);
  } catch (e) {
    return { status: 400, body: { detail: `Could not parse file: ${friendlyDbError(e)}` } };
  }

  return { status: 200, body: await processCombinedRows(rows, ctx) };
}

// ── Template download ─────────────────────────────────────────────────────

const XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Build the unified single-sheet import template as an xlsx Buffer.
 *
 * For canteen shops we emit catalog-only columns (no quantity / cost_per_unit
 * / notes / reference) because canteens don't track per-SKU stock — having
 * those columns in their template would just invite confused data entry.
 */
export async function buildTemplate(shopId: string): Promise<Response> {
  let module: "store" | "canteen" = "store";
  let sampleShopId = "bookstore";
  if (shopId) {
    const rows = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
    if (rows[0]) {
      const m = (rows[0].module ?? "store").toLowerCase();
      module = m === "canteen" ? "canteen" : "store";
      sampleShopId = rows[0].id;
    }
  }

  const wb = XLSX.utils.book_new();
  let aoa: Array<Array<string | number | null>>;
  let sheetName: string;

  if (module === "canteen") {
    sheetName = "Menu";
    aoa = [
      ["product_code", "name", "barcode", "price", "cost_price", "category", "uom", "shop_id"],
      ["FOOD-001", "ข้าวกะเพราหมูสับ", "CT001001", 45, 28, "อาหารจานหลัก", "จาน", sampleShopId],
    ];
  } else {
    sheetName = "Store";
    aoa = [
      ["product_code", "name", "barcode", "price", "cost_price", "category", "uom", "shop_id",
       "quantity", "cost_per_unit", "notes", "reference"],
      ["BK-001", "หนังสือคณิตศาสตร์ ม.1", "BK001001", 120, 70, "หนังสือเรียน", "เล่ม", sampleShopId,
       50, 65, "รับเข้าจาก supplier A", "PO-2026-001"],
    ];
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Approximate width matching the openpyxl version's `max(14, len(header)+4)`.
  ws["!cols"] = aoa[0].map((h) => ({ wch: Math.max(14, String(h).length + 4) }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(out, {
    headers: {
      "Content-Type": XLSX_MEDIA_TYPE,
      "Content-Disposition": 'attachment; filename="import_template.xlsx"',
    },
  });
}

// Suppress unused-import warnings while keeping the JSON path open for an
// audit-log follow-up (matches the Python module's `create_audit_log` calls).
void pgClient;
