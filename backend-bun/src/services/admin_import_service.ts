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
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";
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
  catCache?: Set<string>,
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

  // Skip per-row shop DB lookup when called from processProductRows (pre-validated).
  if (!catCache) {
    const shopRows = await db.select().from(shops).where(eq(shops.id, rowShopId)).limit(1);
    if (!shopRows[0]) {
      errors.push({ row: rowIdx, reason: `ไม่พบร้าน '${rowShopId}' ในระบบ` });
      return null;
    }
  }

  const name = coerceStr(row.product_name ?? row.name);
  const barcode = coerceStr(row.barcode);
  const priceVal = coerceNum(row.external_price ?? row.price);
  const costVal = coerceNum(row.internal_price ?? row.cost_price);

  if (!name) {
    errors.push({ row: rowIdx, reason: "ต้องระบุ 'product_name' (ชื่อสินค้า)" });
    return null;
  }
  if (priceVal === null) {
    errors.push({ row: rowIdx, reason: "'external_price' (ราคาขาย) ต้องเป็นตัวเลข" });
    return null;
  }
  if (costVal === null) {
    errors.push({ row: rowIdx, reason: "'internal_price' (ต้นทุน) ต้องเป็นตัวเลข" });
    return null;
  }

  const category = coerceStr(row.category) || "ทั่วไป";
  const rowProductCode = coerceStr(row.product_code);

  // Ensure category exists — use in-memory cache to avoid per-row DB lookups.
  if (catCache) {
    if (!catCache.has(category)) {
      catCache.add(category); // Claim before await so parallel rows skip the insert.
      await db
        .insert(shopCategories)
        .values({ id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, shopId: rowShopId, name: category })
        .onConflictDoNothing();
    }
  } else {
    await db
      .insert(shopCategories)
      .values({ id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, shopId: rowShopId, name: category })
      .onConflictDoNothing();
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

  // Pre-validate shop once — avoids N identical DB lookups inside the loop.
  if (ctx.defaultShopId) {
    const shopRow = await db.select({ id: shops.id }).from(shops)
      .where(eq(shops.id, ctx.defaultShopId)).limit(1);
    if (!shopRow[0]) {
      errors.push({ row: 2, reason: `ไม่พบร้าน '${ctx.defaultShopId}' ในระบบ` });
      return { created, updated, errors };
    }
  }

  // Category cache: load all existing categories for this shop up-front.
  const existingCats = await db
    .select({ name: shopCategories.name })
    .from(shopCategories)
    .where(eq(shopCategories.shopId, ctx.defaultShopId));
  const catCache = new Set(existingCats.map((c) => c.name));

  // Process in parallel batches of 20 to avoid overwhelming the DB pool.
  const BATCH = 20;
  const allResults: Array<{ product: typeof shopProducts.$inferSelect; wasCreated: boolean } | null> = [];

  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH);
    const batchResults = await Promise.all(
      batch.map((row, i) => upsertProductRow(start + i + 2, row, ctx, errors, catCache))
    );
    allResults.push(...batchResults);
  }

  for (const r of allResults) {
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
      const rowShopId = coerceStr(row.shop_id) || ctx.defaultShopId;
      if (!rowShopId) {
        errors.push({ row: rowIdx, reason: "ต้องระบุ 'shop_id'" });
        continue;
      }
      if (ctx.isManager && rowShopId !== ctx.managerShopId) {
        errors.push({ row: rowIdx, reason: "Manager รับสต็อกได้เฉพาะร้านของตัวเองเท่านั้น" });
        continue;
      }
      const qty = coerceInt(row.stock ?? row.quantity);
      if (qty === null || qty < 0) {
        errors.push({ row: rowIdx, reason: qty !== null && qty < 0 ? "'stock' ต้องไม่ติดลบ" : "ต้องระบุ 'stock' (จำนวนรับ)" });
        continue;
      }
      if (qty === 0) continue;

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

  // Pre-fetch all existing products for this shop in one query so dry-run
  // doesn't hit the DB once per row.
  const existingProducts = await db
    .select({ id: shopProducts.id, name: shopProducts.name, barcode: shopProducts.barcode })
    .from(shopProducts)
    .where(eq(shopProducts.shopId, ctx.defaultShopId));
  const byBarcode = new Map(existingProducts.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
  const byName = new Map(existingProducts.map((p) => [p.name, p]));

  for (let i = 0; i < rows.length; i += 1) {
    const rowIdx = i + 2;
    const row = rows[i];

    const name = coerceStr(row.product_name ?? row.name);
    const priceVal = coerceNum(row.external_price ?? row.price);
    const costVal = coerceNum(row.internal_price ?? row.cost_price);
    const qtyVal = coerceInt(row.stock ?? row.quantity);
    const barcode = coerceStr(row.barcode) || null;
    const category = coerceStr(row.category) || "ทั่วไป";
    const rowShopId = coerceStr(row.shop_id) || ctx.defaultShopId;

    const hasProductData = name && priceVal !== null && costVal !== null;
    const hasStockData = qtyVal !== null && qtyVal > 0;

    if (qtyVal !== null && qtyVal < 0) {
      stockErrors.push({ row: rowIdx, reason: "'stock' ต้องไม่ติดลบ" });
    }

    if (hasProductData) {
      if (!rowShopId) {
        productErrors.push({ row: rowIdx, reason: "ต้องระบุ shop_id" });
        continue;
      }
      if (ctx.isManager && rowShopId !== ctx.managerShopId) {
        productErrors.push({ row: rowIdx, reason: "Manager นำเข้าได้เฉพาะร้านของตัวเองเท่านั้น" });
        continue;
      }

      // Check existing product via in-memory maps — no DB round-trip.
      const exists = barcode ? byBarcode.has(barcode) : byName.has(name);

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
      let productName: string | null = null;
      if (barcode) {
        productName = byBarcode.get(barcode)?.name ?? null;
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
      if (!name) productErrors.push({ row: rowIdx, reason: "ต้องระบุ 'product_name' (ชื่อสินค้า)" });
      else if (priceVal === null) productErrors.push({ row: rowIdx, reason: "'external_price' (ราคาขาย) ต้องเป็นตัวเลข" });
      else productErrors.push({ row: rowIdx, reason: "'internal_price' (ต้นทุน) ต้องเป็นตัวเลข" });
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

  // Pre-validate shop once.
  if (ctx.defaultShopId) {
    const shopRow = await db.select({ id: shops.id }).from(shops)
      .where(eq(shops.id, ctx.defaultShopId)).limit(1);
    if (!shopRow[0]) {
      productResult.errors.push({ row: 2, reason: `ไม่พบร้าน '${ctx.defaultShopId}' ในระบบ` });
      return { products: productResult, stock: stockResult };
    }
  }

  // Pre-load category cache.
  const existingCats = await db
    .select({ name: shopCategories.name })
    .from(shopCategories)
    .where(eq(shopCategories.shopId, ctx.defaultShopId));
  const catCache = new Set(existingCats.map((c) => c.name));

  // Process in parallel batches — each row is independent.
  const BATCH = 20;
  const allRows = rows.map((row, i) => ({ row, rowIdx: i + 2 }));

  for (let start = 0; start < allRows.length; start += BATCH) {
    const batch = allRows.slice(start, start + BATCH);
    await Promise.all(batch.map(async ({ row, rowIdx }) => {
      const name = coerceStr(row.product_name ?? row.name);
      const priceVal = coerceNum(row.external_price ?? row.price);
      const costVal = coerceNum(row.internal_price ?? row.cost_price);
      const qtyVal = coerceInt(row.stock ?? row.quantity);
      const barcode = coerceStr(row.barcode);
      const rowShopId = coerceStr(row.shop_id) || ctx.defaultShopId;

      const hasProductData = name && priceVal !== null && costVal !== null;
      const hasStockData = qtyVal !== null && qtyVal > 0;

      if (qtyVal !== null && qtyVal < 0) {
        stockResult.errors.push({ row: rowIdx, reason: "'stock' ต้องไม่ติดลบ" });
      }

      let product: typeof shopProducts.$inferSelect | undefined;

      if (hasProductData) {
        const r = await upsertProductRow(rowIdx, row, ctx, productResult.errors, catCache);
        if (!r) return;
        if (r.wasCreated) productResult.created += 1;
        else productResult.updated += 1;
        product = r.product;
      } else if (name || priceVal !== null || costVal !== null) {
        if (!name) productResult.errors.push({ row: rowIdx, reason: "ต้องระบุ 'name' (ชื่อสินค้า)" });
        else if (priceVal === null) productResult.errors.push({ row: rowIdx, reason: "'price' (ราคาขาย) ต้องเป็นตัวเลข" });
        else productResult.errors.push({ row: rowIdx, reason: "'cost_price' (ต้นทุน) ต้องเป็นตัวเลข" });
        return;
      }

      if (hasStockData && qtyVal !== null) {
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
          return;
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
    }));
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
      const wb = XLSX.read(buf, { type: "buffer" });
      const sheetNames = wb.SheetNames;
      const isLegacyTwoSheet = sheetNames.includes("Products") && sheetNames.includes("StockReceive");
      if (isLegacyTwoSheet) {
        const productRows = XLSX.utils.sheet_to_json<Row>(wb.Sheets["Products"], { defval: null, raw: true });
        const stockRows = XLSX.utils.sheet_to_json<Row>(wb.Sheets["StockReceive"], { defval: null, raw: true });
        rows = [...productRows, ...stockRows];
      } else {
        rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheetNames[0]], { defval: null, raw: true });
      }
    } catch (e) {
      return { status: 400, body: { detail: `Could not parse file: ${friendlyDbError(e)}` } };
    }
    return { status: 200, body: await dryRunCombinedRows(rows, ctx) };
  }

  // ── Real import ───────────────────────────────────────────────────────────

  let rows: Row[];
  try {
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetNames = wb.SheetNames;
    // Legacy two-sheet workbook detection: when both Products + StockReceive
    // sheets are EXPLICITLY present, use the split-sheet flow so old template
    // files keep working without forcing operators to migrate.
    if (sheetNames.includes("Products") && sheetNames.includes("StockReceive")) {
      const productRows = XLSX.utils.sheet_to_json<Row>(wb.Sheets["Products"], { defval: null, raw: true });
      const stockRows = XLSX.utils.sheet_to_json<Row>(wb.Sheets["StockReceive"], { defval: null, raw: true });
      const products = await processProductRows(productRows, ctx);
      const stock = await processStockRows(stockRows, ctx);
      return { status: 200, body: { products, stock } };
    }
    // Unified single-sheet path — read the first sheet.
    rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheetNames[0]], { defval: null, raw: true });
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
      ["product_code", "product_name", "barcode", "external_price", "internal_price", "category", "uom", "shop_id"],
      ["FOOD-001", "ข้าวกะเพราหมูสับ", "CT001001", 45, 28, "อาหารจานหลัก", "จาน", sampleShopId],
    ];
  } else {
    sheetName = "Store";
    aoa = [
      ["product_code", "product_name", "barcode", "external_price", "internal_price", "category", "uom", "shop_id",
        "stock", "cost_per_unit", "notes", "reference"],
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
