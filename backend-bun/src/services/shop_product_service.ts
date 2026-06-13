import { eq, and, or, ilike, asc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  shops,
  shopProducts,
  shopCategories,
  menuOptionGroups,
  unitsOfMeasure,
  productBarcodes,
} from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";

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
