import { eq, and, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { shops } from "@/db/schema";
import { pgToIso } from "@/lib/dates";

export type ShopModule = "canteen" | "store";

export interface ShopRow {
  id: string;
  name: string;
  shop_type: string;
  description: string | null;
  is_active: boolean;
  allow_department_charge: boolean;
  module: string;
  uses_dual_pricing: boolean;
  products_order_version: number;
  created_at: string;
  spending_group_id: number | null;
}

export interface ListShopsFilters {
  activeOnly?: boolean;
  module?: ShopModule;
}

/**
 * Mirror of FastAPI GET /api/v1/shops/ — returns active shops by default,
 * optionally filtered by module. Order by id asc to match SQLAlchemy version.
 *
 * Response shape uses snake_case keys to stay backward-compatible with the
 * frontend's existing Pydantic-shaped expectations.
 */
export async function listShops(filters: ListShopsFilters = {}): Promise<ShopRow[]> {
  const conditions = [];
  if (filters.activeOnly !== false) {
    conditions.push(eq(shops.isActive, true));
  }
  if (filters.module) {
    conditions.push(eq(shops.module, filters.module));
  }

  const rows = await db
    .select()
    .from(shops)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(shops.id));

  return rows.map(toShopResponse);
}

export async function getShop(shopId: string): Promise<ShopRow | null> {
  const rows = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
  return rows[0] ? toShopResponse(rows[0]) : null;
}

function toShopResponse(row: typeof shops.$inferSelect): ShopRow {
  return {
    id: row.id,
    name: row.name,
    shop_type: row.shopType,
    description: row.description ?? null,
    is_active: row.isActive,
    allow_department_charge: row.allowDepartmentCharge,
    module: row.module,
    uses_dual_pricing: row.usesDualPricing,
    products_order_version: row.productsOrderVersion,
    created_at: pgToIso(row.createdAt)!,
    spending_group_id: row.spendingGroupId ?? null,
  };
}
