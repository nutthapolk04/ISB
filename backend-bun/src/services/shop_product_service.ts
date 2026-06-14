import { eq, and, or, ilike, asc, inArray, ne } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import {
  shops,
  shopProducts,
  shopCategories,
  menuOptionGroups,
  unitsOfMeasure,
  productBarcodes,
} from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";
import type { AccessTokenPayload } from "@/middleware/auth";
import { fifoReceiveInTx, fifoAdjustInTx } from "@/services/inventory_fifo";

export interface ExtraBarcodeDTO {
  id: number;
  barcode: string;
  label: string | null;
}

export interface ShopProductDTO {
  id: number;
  shop_id: string;
  product_code: string;
  barcode: string | null;
  name: string;
  category: string;
  external_price: number;
  internal_price: number;
  vat_percent: number;
  avg_cost: number;
  stock: number;
  min_stock: number;
  is_active: boolean;
  photo_url: string | null;
  color: string | null;
  sort_order: number;
  has_options: boolean;
  uom_id: number | null;
  uom_code: string | null;
  uom_name: string | null;
  short_name: string | null;
  extra_barcodes: ExtraBarcodeDTO[];
}

export interface ShopCategoryDTO {
  id: string;
  shop_id: string;
  name: string;
  created_at: string;
}

export interface ListShopProductsFilters {
  search?: string;
  category?: string;
  includeInactive?: boolean;
}

async function assertShop(shopId: string): Promise<void> {
  const rows = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!rows[0]) {
    const err = new Error(`Shop '${shopId}' not found`);
    (err as { status?: number }).status = 404;
    throw err;
  }
}

export async function listShopProducts(
  shopId: string,
  filters: ListShopProductsFilters = {},
): Promise<ShopProductDTO[]> {
  await assertShop(shopId);

  const conds = [eq(shopProducts.shopId, shopId)];
  if (!filters.includeInactive) conds.push(eq(shopProducts.isActive, true));
  if (filters.search) {
    const term = `%${filters.search.toLowerCase()}%`;
    conds.push(
      or(
        ilike(shopProducts.name, term),
        ilike(shopProducts.productCode, term),
        ilike(shopProducts.barcode, term),
      )!,
    );
  }
  if (filters.category) conds.push(eq(shopProducts.category, filters.category));

  const rows = await db
    .select()
    .from(shopProducts)
    .where(and(...conds))
    .orderBy(asc(shopProducts.sortOrder), asc(shopProducts.name));

  if (rows.length === 0) return [];

  const productIds = rows.map((r) => r.id);
  const uomIds = rows.map((r) => r.uomId).filter((x): x is number => x !== null);

  const [extraBarcodes, optionGroups, uoms] = await Promise.all([
    db
      .select()
      .from(productBarcodes)
      .where(inArray(productBarcodes.productId, productIds))
      .orderBy(asc(productBarcodes.createdAt)),
    db
      .select({ productId: menuOptionGroups.productId })
      .from(menuOptionGroups)
      .where(inArray(menuOptionGroups.productId, productIds)),
    uomIds.length > 0
      ? db.select().from(unitsOfMeasure).where(inArray(unitsOfMeasure.id, uomIds))
      : Promise.resolve([] as Array<typeof unitsOfMeasure.$inferSelect>),
  ]);

  const barcodesByProduct = new Map<number, ExtraBarcodeDTO[]>();
  for (const b of extraBarcodes) {
    const arr = barcodesByProduct.get(b.productId) ?? [];
    arr.push({ id: b.id, barcode: b.barcode, label: b.label ?? null });
    barcodesByProduct.set(b.productId, arr);
  }

  const productsWithOptions = new Set(optionGroups.map((g) => g.productId));
  const uomById = new Map(uoms.map((u) => [u.id, u]));

  return rows.map((p) => toShopProductDTO(p, {
    extraBarcodes: barcodesByProduct.get(p.id) ?? [],
    hasOptions: productsWithOptions.has(p.id),
    uom: p.uomId !== null ? uomById.get(p.uomId) ?? null : null,
  }));
}

export async function listShopCategories(shopId: string): Promise<ShopCategoryDTO[]> {
  await assertShop(shopId);
  const rows = await db
    .select()
    .from(shopCategories)
    .where(eq(shopCategories.shopId, shopId))
    .orderBy(asc(shopCategories.name));
  return rows.map((r) => ({
    id: r.id,
    shop_id: r.shopId,
    name: r.name,
    created_at: pgToIso(r.createdAt)!,
  }));
}

async function getProductInShop(shopId: string, productId: number): Promise<typeof shopProducts.$inferSelect> {
  const rows = await db
    .select()
    .from(shopProducts)
    .where(and(eq(shopProducts.id, productId), eq(shopProducts.shopId, shopId)))
    .limit(1);
  if (!rows[0]) {
    const err = new Error("Product not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  return rows[0];
}

async function shopOrThrow(shopId: string): Promise<typeof shops.$inferSelect> {
  const rows = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!rows[0]) {
    const err = new Error("Shop not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  return rows[0];
}

async function loadProductDTO(productId: number): Promise<ShopProductDTO> {
  const rows = await db.select().from(shopProducts).where(eq(shopProducts.id, productId)).limit(1);
  if (!rows[0]) {
    const err = new Error("Product not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  const p = rows[0];
  const [extraBarcodes, optionGroups, uom] = await Promise.all([
    db
      .select()
      .from(productBarcodes)
      .where(eq(productBarcodes.productId, p.id))
      .orderBy(asc(productBarcodes.createdAt)),
    db.select({ productId: menuOptionGroups.productId }).from(menuOptionGroups).where(eq(menuOptionGroups.productId, p.id)).limit(1),
    p.uomId !== null
      ? db.select().from(unitsOfMeasure).where(eq(unitsOfMeasure.id, p.uomId)).limit(1)
      : Promise.resolve([] as Array<typeof unitsOfMeasure.$inferSelect>),
  ]);
  return toShopProductDTO(p, {
    extraBarcodes: extraBarcodes.map((b) => ({ id: b.id, barcode: b.barcode, label: b.label ?? null })),
    hasOptions: optionGroups.length > 0,
    uom: uom[0] ?? null,
  });
}

export interface CreateShopProductInput {
  product_code: string;
  barcode?: string | null;
  name: string;
  category?: string;
  external_price: number;
  internal_price?: number | null;
  vat_percent?: number;
  avg_cost?: number;
  stock?: number;
  min_stock?: number;
  color?: string | null;
  uom_id?: number | null;
}

export async function createShopProduct(
  shopId: string,
  input: CreateShopProductInput,
  userId: number,
): Promise<ShopProductDTO> {
  const shop = await shopOrThrow(shopId);

  // Dup product_code in this shop (active only — matches FastAPI)
  const dup = await db
    .select({ id: shopProducts.id })
    .from(shopProducts)
    .where(and(
      eq(shopProducts.shopId, shopId),
      eq(shopProducts.productCode, input.product_code),
      eq(shopProducts.isActive, true),
    ))
    .limit(1);
  if (dup[0]) {
    const err = new Error("Product code already exists in this shop");
    (err as { status?: number }).status = 409;
    throw err;
  }

  const externalPrice = input.external_price;
  const internalPrice = input.internal_price ?? externalPrice;
  const vatPercent = input.vat_percent ?? 7.0;
  const avgCost = input.avg_cost ?? 0;
  const stock = input.stock ?? 0;
  const minStock = input.min_stock ?? 0;
  const category = input.category ?? "ทั่วไป";

  const today = new Date().toISOString().slice(0, 10);

  const newProductId = await pgClient.begin(async (sqlTx) => {
    const ins = await sqlTx<Array<{ id: number }>>`
      INSERT INTO shop_products
        (shop_id, product_code, barcode, name, category,
         external_price, internal_price, vat_percent, avg_cost,
         stock, min_stock, is_active, color, uom_id, sort_order)
      VALUES (${shopId}, ${input.product_code}, ${input.barcode ?? null}, ${input.name},
              ${category}, ${externalPrice}, ${internalPrice}, ${vatPercent},
              ${avgCost}, ${stock}, ${minStock}, true, ${input.color ?? null},
              ${input.uom_id ?? null}, 0)
      RETURNING id
    `;
    const newId = ins[0].id;

    // FIFO lot creation is deferred — we reject FIFO checkout/adjust anyway
    if (shop.shopType !== "fifo" && stock > 0) {
      await sqlTx`
        INSERT INTO shop_movements
          (date, product_id, product_name, shop_id, type, quantity,
           stock_before, stock_after, cost_per_unit, note, created_by)
        VALUES (${today}, ${newId}, ${input.name}, ${shopId}, 'receive',
                ${stock}, 0, ${stock}, ${avgCost}, 'Initial stock', ${userId})
      `;
    }

    // Auto-register in existing price panels for this shop
    await sqlTx`
      INSERT INTO price_panel_items (panel_id, product_id, price, included)
      SELECT id, ${newId}, NULL, true FROM price_panels WHERE shop_id = ${shopId}
    `;
    return newId;
  });

  return loadProductDTO(newProductId);
}

export interface UpdateShopProductInput {
  product_code?: string | null;
  barcode?: string | null;
  name?: string | null;
  category?: string | null;
  external_price?: number | null;
  internal_price?: number | null;
  vat_percent?: number | null;
  min_stock?: number | null;
  is_active?: boolean | null;
  photo_url?: string | null;
  color?: string | null;
  uom_id?: number | null;
  short_name?: string | null;
  sort_order?: number | null;
}

const COSMETIC_FIELDS = new Set(["color", "sort_order", "short_name"]);

export async function updateShopProduct(
  caller: AccessTokenPayload,
  shopId: string,
  productId: number,
  input: UpdateShopProductInput,
): Promise<ShopProductDTO> {
  const isAdminOrManager = caller.is_superuser || caller.roles.some((r) => r === "admin" || r === "manager");
  if (!isAdminOrManager) {
    // Cashier can only touch cosmetic fields.
    const sentKeys = Object.entries(input).filter(([, v]) => v !== undefined).map(([k]) => k);
    const forbidden = sentKeys.filter((k) => !COSMETIC_FIELDS.has(k));
    if (forbidden.length > 0) {
      const err = new Error(
        `Role can only edit color/sort_order/short_name; not [${forbidden.join(", ")}]`,
      );
      (err as { status?: number }).status = 403;
      throw err;
    }
  }

  const product = await getProductInShop(shopId, productId);
  const oldPrices = {
    external_price: pgNumber(product.externalPrice) ?? 0,
    internal_price: pgNumber(product.internalPrice) ?? 0,
  };

  const updates: Record<string, unknown> = {};
  const map: Array<[keyof UpdateShopProductInput, keyof typeof shopProducts.$inferInsert]> = [
    ["product_code", "productCode"],
    ["barcode", "barcode"],
    ["name", "name"],
    ["category", "category"],
    ["external_price", "externalPrice"],
    ["internal_price", "internalPrice"],
    ["vat_percent", "vatPercent"],
    ["min_stock", "minStock"],
    ["is_active", "isActive"],
    ["photo_url", "photoUrl"],
    ["color", "color"],
    ["uom_id", "uomId"],
    ["short_name", "shortName"],
    ["sort_order", "sortOrder"],
  ];
  for (const [inKey, dbKey] of map) {
    if (input[inKey] !== undefined) {
      let v: unknown = input[inKey];
      if (dbKey === "uomId" && v === 0) v = null; // 0 means clear
      if ((dbKey === "externalPrice" || dbKey === "internalPrice" || dbKey === "vatPercent") && v !== null) {
        v = String(v);
      }
      updates[dbKey] = v;
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.update(shopProducts).set(updates).where(eq(shopProducts.id, productId));
  }

  const fresh = await loadProductDTO(productId);
  const priceChanged = fresh.external_price !== oldPrices.external_price ||
    fresh.internal_price !== oldPrices.internal_price;
  if (priceChanged) {
    await db.insert(menuOptionGroups).values; // no-op — type hint workaround
    // Insert audit row via raw insert to avoid an extra Drizzle import path:
    await pgClient`
      INSERT INTO audit_logs (entity_type, entity_id, entity_name, shop_id, action, user_id, changes_json)
      VALUES ('shop_product', ${productId}, ${fresh.name}, ${shopId}, 'UPDATE',
              ${Number(caller.sub)}, ${{ old: oldPrices, new: { external_price: fresh.external_price, internal_price: fresh.internal_price } }})
    `;
  }

  return fresh;
}

export async function deleteShopProduct(
  caller: AccessTokenPayload,
  shopId: string,
  productId: number,
): Promise<void> {
  const product = await getProductInShop(shopId, productId);
  const snapshot = {
    name: product.name,
    external_price: pgNumber(product.externalPrice) ?? 0,
    internal_price: pgNumber(product.internalPrice) ?? 0,
    stock: product.stock,
    category: product.category,
  };
  await pgClient.begin(async (sqlTx) => {
    await sqlTx`UPDATE shop_products SET is_active = false, updated_at = NOW() WHERE id = ${productId}`;
    await sqlTx`
      INSERT INTO audit_logs (entity_type, entity_id, entity_name, shop_id, action, user_id, changes_json)
      VALUES ('shop_product', ${productId}, ${product.name}, ${shopId}, 'DELETE',
              ${Number(caller.sub)}, ${sqlTx.json({ snapshot })})
    `;
  });
}

// ── Receive / Adjust stock (avg_cost shops only) ───────────────────────

export interface ReceiveStockItemInput {
  product_id: number;
  qty: number;
  cost_per_unit: number;
  po?: string | null;
  invoice?: string | null;
  note?: string | null;
}

export async function receiveStock(args: {
  shopId: string;
  items: ReceiveStockItemInput[];
  userId: number;
}): Promise<ShopProductDTO[]> {
  const shop = await shopOrThrow(args.shopId);
  const isFifo = shop.shopType === "fifo";

  const today = new Date().toISOString().slice(0, 10);
  const updatedIds: number[] = [];

  await pgClient.begin(async (sqlTx) => {
    for (const item of args.items) {
      const pRows = await sqlTx<Array<{ id: number; name: string; shop_id: string; stock: number; avg_cost: string }>>`
        SELECT id, name, shop_id, stock, avg_cost FROM shop_products
        WHERE id = ${item.product_id} AND shop_id = ${args.shopId} FOR UPDATE
      `;
      const product = pRows[0];
      if (!product) {
        const err = new Error(`Product ${item.product_id} not found in shop '${args.shopId}'`);
        (err as { status?: number }).status = 404;
        throw err;
      }
      const stockBefore = product.stock;
      let newStock: number;
      let newAvgRounded: number;
      if (isFifo) {
        const r = await fifoReceiveInTx(sqlTx, product.id, product.shop_id, stockBefore, item.qty, item.cost_per_unit);
        newStock = r.newStock;
        newAvgRounded = r.newAvgCost;
      } else {
        const oldAvg = pgNumber(product.avg_cost) ?? 0;
        newStock = stockBefore + item.qty;
        const newAvg = (stockBefore + item.qty) > 0
          ? (stockBefore * oldAvg + item.qty * item.cost_per_unit) / (stockBefore + item.qty)
          : item.cost_per_unit;
        newAvgRounded = Math.round(newAvg * 10000) / 10000;
      }
      await sqlTx`UPDATE shop_products SET stock = ${newStock}, avg_cost = ${newAvgRounded}, updated_at = NOW() WHERE id = ${product.id}`;
      await sqlTx`
        INSERT INTO shop_movements
          (date, product_id, product_name, shop_id, type, quantity,
           stock_before, stock_after, cost_per_unit, reference, note, created_by)
        VALUES (${today}, ${product.id}, ${product.name}, ${product.shop_id}, 'receive',
                ${item.qty}, ${stockBefore}, ${newStock}, ${item.cost_per_unit},
                ${item.po ?? item.invoice ?? null}, ${item.note ?? null}, ${args.userId})
      `;
      updatedIds.push(product.id);
    }
  });

  return Promise.all(updatedIds.map(loadProductDTO));
}

export async function adjustStock(args: {
  shopId: string;
  productId: number;
  delta: number;
  reason: string;
  costPerUnit?: number | null;
  userId: number;
}): Promise<ShopProductDTO> {
  if (args.delta === 0) {
    const err = new Error("delta cannot be 0");
    (err as { status?: number }).status = 422;
    throw err;
  }
  const shop = await shopOrThrow(args.shopId);
  const isFifo = shop.shopType === "fifo";

  const today = new Date().toISOString().slice(0, 10);

  await pgClient.begin(async (sqlTx) => {
    const pRows = await sqlTx<Array<{ id: number; name: string; shop_id: string; stock: number; avg_cost: string }>>`
      SELECT id, name, shop_id, stock, avg_cost FROM shop_products
      WHERE id = ${args.productId} AND shop_id = ${args.shopId} FOR UPDATE
    `;
    const product = pRows[0];
    if (!product) {
      const err = new Error("Product not found");
      (err as { status?: number }).status = 404;
      throw err;
    }
    const stockBefore = product.stock;
    let stockAfter: number;
    let newAvg = pgNumber(product.avg_cost) ?? 0;
    if (isFifo) {
      const r = await fifoAdjustInTx(sqlTx, product.id, product.shop_id, args.delta, newAvg, args.costPerUnit ?? null);
      stockAfter = r.newStock;
      newAvg = r.newAvgCost;
    } else {
      stockAfter = stockBefore + args.delta;
      if (args.delta > 0 && args.costPerUnit !== null && args.costPerUnit !== undefined) {
        newAvg = stockBefore + args.delta > 0
          ? (stockBefore * newAvg + args.delta * args.costPerUnit) / (stockBefore + args.delta)
          : args.costPerUnit;
        newAvg = Math.round(newAvg * 10000) / 10000;
      }
    }
    await sqlTx`UPDATE shop_products SET stock = ${stockAfter}, avg_cost = ${newAvg}, updated_at = NOW() WHERE id = ${product.id}`;
    await sqlTx`
      INSERT INTO shop_movements
        (date, product_id, product_name, shop_id, type, quantity,
         stock_before, stock_after, cost_per_unit, note, created_by)
      VALUES (${today}, ${product.id}, ${product.name}, ${product.shop_id}, 'adjustment',
              ${args.delta}, ${stockBefore}, ${stockAfter},
              ${args.costPerUnit ?? null}, ${args.reason}, ${args.userId})
    `;
  });

  return loadProductDTO(args.productId);
}

// ── Shop categories CRUD ──────────────────────────────────────────────

export async function createShopCategory(shopId: string, name: string): Promise<ShopCategoryDTO> {
  await shopOrThrow(shopId);
  const id = `cat-${Date.now()}`;
  const [created] = await db
    .insert(shopCategories)
    .values({ id, shopId, name: name.trim() })
    .returning();
  return {
    id: created.id,
    shop_id: created.shopId,
    name: created.name,
    created_at: pgToIso(created.createdAt)!,
  };
}

export async function updateShopCategory(shopId: string, categoryId: string, name: string): Promise<ShopCategoryDTO> {
  const rows = await db
    .update(shopCategories)
    .set({ name: name.trim() })
    .where(and(eq(shopCategories.id, categoryId), eq(shopCategories.shopId, shopId)))
    .returning();
  if (!rows[0]) {
    const err = new Error("Category not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  return {
    id: rows[0].id,
    shop_id: rows[0].shopId,
    name: rows[0].name,
    created_at: pgToIso(rows[0].createdAt)!,
  };
}

export async function deleteShopCategory(shopId: string, categoryId: string): Promise<void> {
  const rows = await db
    .delete(shopCategories)
    .where(and(eq(shopCategories.id, categoryId), eq(shopCategories.shopId, shopId)))
    .returning({ id: shopCategories.id });
  if (!rows[0]) {
    const err = new Error("Category not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
}

function toShopProductDTO(
  p: typeof shopProducts.$inferSelect,
  ctx: {
    extraBarcodes: ExtraBarcodeDTO[];
    hasOptions: boolean;
    uom: typeof unitsOfMeasure.$inferSelect | null;
  },
): ShopProductDTO {
  return {
    id: p.id,
    shop_id: p.shopId,
    product_code: p.productCode,
    barcode: p.barcode ?? null,
    name: p.name,
    category: p.category,
    external_price: pgNumber(p.externalPrice) ?? 0,
    internal_price: pgNumber(p.internalPrice) ?? 0,
    vat_percent: pgNumber(p.vatPercent) ?? 0,
    avg_cost: pgNumber(p.avgCost) ?? 0,
    stock: p.stock,
    min_stock: p.minStock,
    is_active: p.isActive,
    photo_url: p.photoUrl ?? null,
    color: p.color ?? null,
    sort_order: p.sortOrder,
    has_options: ctx.hasOptions,
    uom_id: p.uomId ?? null,
    uom_code: ctx.uom?.code ?? null,
    uom_name: ctx.uom?.name ?? null,
    short_name: p.shortName ?? null,
    extra_barcodes: ctx.extraBarcodes,
  };
}
