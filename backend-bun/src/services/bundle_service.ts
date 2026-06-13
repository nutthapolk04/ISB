import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { productBundles, bundleItems, shopProducts, shops } from "@/db/schema";
import { pgNumber } from "@/lib/dates";

export interface BundleItemDTO {
  id: number;
  product_id: number;
  product_name: string;
  product_code: string;
  quantity: number;
  unit_price: number;
  sort_order: number;
}

export interface BundleDTO {
  id: number;
  shop_id: string;
  bundle_code: string;
  barcode: string | null;
  name: string;
  description: string | null;
  external_price: number;
  internal_price: number;
  photo_url: string | null;
  color: string | null;
  sort_order: number;
  is_active: boolean;
  items: BundleItemDTO[];
  total_items_value: number;
  savings: number;
}

export interface BundleStockItemDTO {
  product_id: number;
  product_name: string;
  required: number;
  available: number;
  sufficient: boolean;
  max_bundles?: number;
}

export interface BundleStockStatusDTO {
  bundle_id: number;
  available: boolean;
  max_quantity: number;
  items: BundleStockItemDTO[];
}

async function assertShop(shopId: string): Promise<void> {
  const rows = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!rows[0]) {
    const err = new Error("Shop not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
}

async function loadItemsForBundles(bundleIds: number[]): Promise<Map<number, BundleItemDTO[]>> {
  if (bundleIds.length === 0) return new Map();
  const rows = await db
    .select({ item: bundleItems, product: shopProducts })
    .from(bundleItems)
    .innerJoin(shopProducts, eq(shopProducts.id, bundleItems.productId))
    .where(inArray(bundleItems.bundleId, bundleIds))
    .orderBy(asc(bundleItems.sortOrder));
  const out = new Map<number, BundleItemDTO[]>();
  for (const { item, product } of rows) {
    const arr = out.get(item.bundleId) ?? [];
    arr.push({
      id: item.id,
      product_id: item.productId,
      product_name: product.name,
      product_code: product.productCode,
      quantity: item.quantity,
      unit_price: pgNumber(product.externalPrice) ?? 0,
      sort_order: item.sortOrder,
    });
    out.set(item.bundleId, arr);
  }
  return out;
}

function toBundleDTO(b: typeof productBundles.$inferSelect, items: BundleItemDTO[]): BundleDTO {
  const total = items.reduce((s, it) => s + it.unit_price * it.quantity, 0);
  const ext = pgNumber(b.externalPrice) ?? 0;
  return {
    id: b.id,
    shop_id: b.shopId,
    bundle_code: b.bundleCode,
    barcode: b.barcode ?? null,
    name: b.name,
    description: b.description ?? null,
    external_price: ext,
    internal_price: pgNumber(b.internalPrice) ?? 0,
    photo_url: b.photoUrl ?? null,
    color: b.color ?? null,
    sort_order: b.sortOrder,
    is_active: b.isActive,
    items,
    total_items_value: total,
    savings: Math.max(0, total - ext),
  };
}

export async function listBundles(shopId: string, includeInactive = false): Promise<BundleDTO[]> {
  await assertShop(shopId);
  const conds = [eq(productBundles.shopId, shopId)];
  if (!includeInactive) conds.push(eq(productBundles.isActive, true));
  const bundles = await db
    .select()
    .from(productBundles)
    .where(and(...conds))
    .orderBy(asc(productBundles.sortOrder), asc(productBundles.name));
  if (bundles.length === 0) return [];
  const itemsByBundle = await loadItemsForBundles(bundles.map((b) => b.id));
  return bundles.map((b) => toBundleDTO(b, itemsByBundle.get(b.id) ?? []));
}

export async function getBundle(shopId: string, bundleId: number): Promise<BundleDTO> {
  await assertShop(shopId);
  const rows = await db
    .select()
    .from(productBundles)
    .where(and(eq(productBundles.id, bundleId), eq(productBundles.shopId, shopId)))
    .limit(1);
  if (!rows[0]) {
    const err = new Error("Bundle not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  const itemsByBundle = await loadItemsForBundles([rows[0].id]);
  return toBundleDTO(rows[0], itemsByBundle.get(rows[0].id) ?? []);
}

export async function checkBundleStock(shopId: string, bundleId: number): Promise<BundleStockStatusDTO> {
  await assertShop(shopId);
  const bRows = await db
    .select()
    .from(productBundles)
    .where(and(eq(productBundles.id, bundleId), eq(productBundles.shopId, shopId)))
    .limit(1);
  if (!bRows[0]) {
    const err = new Error("Bundle not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  const items = await db
    .select({ item: bundleItems, product: shopProducts })
    .from(bundleItems)
    .leftJoin(shopProducts, eq(shopProducts.id, bundleItems.productId))
    .where(eq(bundleItems.bundleId, bundleId))
    .orderBy(asc(bundleItems.sortOrder));

  let maxBundles = Number.POSITIVE_INFINITY;
  const itemsStatus: BundleStockItemDTO[] = items.map(({ item, product }) => {
    if (!product) {
      maxBundles = 0;
      return {
        product_id: item.productId,
        product_name: "Unknown",
        required: item.quantity,
        available: 0,
        sufficient: false,
      };
    }
    const canMake = item.quantity > 0 ? Math.floor(product.stock / item.quantity) : Number.POSITIVE_INFINITY;
    maxBundles = Math.min(maxBundles, canMake);
    return {
      product_id: product.id,
      product_name: product.name,
      required: item.quantity,
      available: product.stock,
      sufficient: product.stock >= item.quantity,
      max_bundles: Number.isFinite(canMake) ? canMake : 999999,
    };
  });

  return {
    bundle_id: bundleId,
    available: maxBundles > 0,
    max_quantity: Number.isFinite(maxBundles) ? maxBundles : 999999,
    items: itemsStatus,
  };
}
