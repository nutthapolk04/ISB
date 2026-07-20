import { eq, and, asc, sql } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import { shops, shopProducts, receipts, users } from "@/db/schema";
import { pgToIso, pgNumber } from "@/lib/dates";

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
    receipt_header: string | null;
    receipt_footer: string | null;
    void_shortcuts: string[];
    shop_number: number | null;
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

// ── Create / Update / Delete ─────────────────────────────────────────────────

export interface CreateShopInput {
    id: string;
    name: string;
    shop_type?: "avg_cost" | "fifo";
    description?: string | null;
    allow_department_charge?: boolean;
    module?: ShopModule;
    uses_dual_pricing?: boolean;
    shop_number?: number | null;
}

export async function createShop(input: CreateShopInput): Promise<ShopRow> {
    const existing = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, input.id)).limit(1);
    if (existing[0]) {
        const err = new Error(`Shop '${input.id}' already exists`);
        (err as { status?: number }).status = 409;
        throw err;
    }
    const rows = await db
        .insert(shops)
        .values({
            id: input.id,
            name: input.name,
            shopType: input.shop_type ?? "avg_cost",
            description: input.description ?? null,
            isActive: true,
            allowDepartmentCharge: input.allow_department_charge ?? false,
            module: input.module ?? "store",
            usesDualPricing: input.uses_dual_pricing ?? true,
            shopNumber: input.shop_number ?? null,
        })
        .returning();
    return toShopResponse(rows[0]);
}

export interface UpdateShopInput {
    name?: string | null;
    description?: string | null;
    is_active?: boolean | null;
    allow_department_charge?: boolean | null;
    module?: ShopModule | null;
    uses_dual_pricing?: boolean | null;
    receipt_header?: string | null;
    receipt_footer?: string | null;
    shop_number?: number | null;
}

export async function updateShop(shopId: string, input: UpdateShopInput): Promise<ShopRow> {
    const updates: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== null) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.is_active !== undefined && input.is_active !== null) updates.isActive = input.is_active;
    if (input.allow_department_charge !== undefined && input.allow_department_charge !== null) updates.allowDepartmentCharge = input.allow_department_charge;
    if (input.module !== undefined && input.module !== null) updates.module = input.module;
    if (input.uses_dual_pricing !== undefined && input.uses_dual_pricing !== null) updates.usesDualPricing = input.uses_dual_pricing;
    if (input.receipt_header !== undefined) updates.receiptHeader = input.receipt_header;
    if (input.receipt_footer !== undefined) updates.receiptFooter = input.receipt_footer;
    if (input.shop_number !== undefined) updates.shopNumber = input.shop_number;

    if (Object.keys(updates).length > 0) {
        const updated = await db
            .update(shops)
            .set(updates)
            .where(eq(shops.id, shopId))
            .returning();
        if (!updated[0]) {
            const err = new Error("Shop not found");
            (err as { status?: number }).status = 404;
            throw err;
        }
        return toShopResponse(updated[0]);
    }
    const rows = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
    if (!rows[0]) {
        const err = new Error("Shop not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    return toShopResponse(rows[0]);
}

export interface DeleteShopResult {
    status: "deleted" | "deactivated";
    receipts_preserved: number;
}

/**
 * Mirror of FastAPI DELETE /shops/{id}:
 *  - If any Receipt references this shop → soft-delete (isActive=false)
 *  - Otherwise hard-delete (cascade removes products/categories/movements/lots).
 *  - Unassign users.shop_id = null when hard-deleting.
 */
export async function deleteShop(shopId: string): Promise<DeleteShopResult> {
    const sRows = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).limit(1);
    if (!sRows[0]) {
        const err = new Error("Shop not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    const refRows = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(receipts)
        .where(eq(receipts.shopId, shopId));
    const refCount = refRows[0]?.c ?? 0;

    if (refCount > 0) {
        await db.update(shops).set({ isActive: false }).where(eq(shops.id, shopId));
        return { status: "deactivated", receipts_preserved: refCount };
    }
    await pgClient.begin(async (sqlTx) => {
        await sqlTx`UPDATE users SET shop_id = NULL WHERE shop_id = ${shopId}`;
        await sqlTx`DELETE FROM shops WHERE id = ${shopId}`;
    });
    return { status: "deleted", receipts_preserved: 0 };
}

// ── Stats / Low-stock ────────────────────────────────────────────────────────

export interface ShopStatsResponse {
    total_products: number;
    low_stock_count: number;
    total_value: number;
}

export async function shopStats(shopId: string): Promise<ShopStatsResponse> {
    const sRows = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).limit(1);
    if (!sRows[0]) {
        const err = new Error("Shop not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    const products = await db
        .select({
            stock: shopProducts.stock,
            minStock: shopProducts.minStock,
            avgCost: shopProducts.avgCost,
        })
        .from(shopProducts)
        .where(and(eq(shopProducts.shopId, shopId), eq(shopProducts.isActive, true)));

    let totalValue = 0;
    let lowStockCount = 0;
    for (const p of products) {
        if (p.minStock > 0 && p.stock <= p.minStock) lowStockCount += 1;
        if (p.stock > 0) totalValue += p.stock * (pgNumber(p.avgCost) ?? 0);
    }
    return {
        total_products: products.length,
        low_stock_count: lowStockCount,
        total_value: Math.round(totalValue * 100) / 100,
    };
}

export interface LowStockItem {
    id: number;
    shop_id: string;
    shop_name: string;
    product_code: string;
    name: string;
    stock: number;
    min_stock: number;
    category: string;
}

/** GET /shops/low-stock — all active products across active shops where stock <= min_stock. */
export async function listLowStock(): Promise<LowStockItem[]> {
    const rows = await db
        .select({
            id: shopProducts.id,
            shopId: shopProducts.shopId,
            shopName: shops.name,
            productCode: shopProducts.productCode,
            name: shopProducts.name,
            stock: shopProducts.stock,
            minStock: shopProducts.minStock,
            category: shopProducts.category,
        })
        .from(shopProducts)
        .innerJoin(shops, eq(shops.id, shopProducts.shopId))
        .where(
            and(
                eq(shopProducts.isActive, true),
                eq(shops.isActive, true),
                sql`${shopProducts.minStock} > 0`,
                sql`${shopProducts.stock} <= ${shopProducts.minStock}`,
            ),
        )
        .orderBy(asc(shopProducts.stock));
    // Suppress unused-imports warning on `users` table import
    void users;
    return rows.map((r) => ({
        id: r.id,
        shop_id: r.shopId,
        shop_name: r.shopName,
        product_code: r.productCode,
        name: r.name,
        stock: r.stock,
        min_stock: r.minStock,
        category: r.category,
    }));
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
        receipt_header: row.receiptHeader ?? null,
        receipt_footer: row.receiptFooter ?? null,
        void_shortcuts: Array.isArray(row.voidShortcuts) ? row.voidShortcuts : [],
        shop_number: row.shopNumber ?? null,
    };
}

const MAX_SHORTCUTS = 24;
const MAX_SHORTCUT_LEN = 60;

export async function updateVoidShortcuts(shopId: string, shortcuts: string[]): Promise<ShopRow> {
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const raw of shortcuts) {
        if (typeof raw !== "string") continue;
        const v = raw.trim();
        if (!v || v.length > MAX_SHORTCUT_LEN) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        cleaned.push(v);
        if (cleaned.length >= MAX_SHORTCUTS) break;
    }
    const updated = await db
        .update(shops)
        .set({ voidShortcuts: cleaned, updatedAt: new Date().toISOString() })
        .where(eq(shops.id, shopId))
        .returning();
    if (!updated[0]) {
        const err = new Error("Shop not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    return toShopResponse(updated[0]);
}
