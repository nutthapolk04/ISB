import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
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

function isPgUniqueViolation(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const code = (err as { code?: string }).code;
    if (code === "23505") return true;
    const cause = (err as { cause?: unknown }).cause;
    return isPgUniqueViolation(cause);
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

export interface BundleItemInput {
    product_id: number;
    quantity: number;
}

export interface CreateBundleInput {
    bundle_code: string;
    barcode?: string | null;
    name: string;
    description?: string | null;
    external_price: number;
    internal_price?: number | null;
    color?: string | null;
    items: BundleItemInput[];
}

async function validateBundleProducts(shopId: string, productIds: number[]): Promise<void> {
    if (productIds.length === 0) {
        const err = new Error("Bundle must have at least one item");
        (err as { status?: number }).status = 400;
        throw err;
    }
    const rows = await db
        .select({ id: shopProducts.id })
        .from(shopProducts)
        .where(and(inArray(shopProducts.id, productIds), eq(shopProducts.shopId, shopId)));
    const found = new Set(rows.map((r) => r.id));
    const missing = productIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
        const err = new Error(`Products not found in this shop: ${missing.join(", ")}`);
        (err as { status?: number }).status = 400;
        throw err;
    }
}

export async function createBundle(shopId: string, input: CreateBundleInput): Promise<BundleDTO> {
    await assertShop(shopId);

    const dup = await db
        .select({ id: productBundles.id })
        .from(productBundles)
        .where(and(eq(productBundles.shopId, shopId), eq(productBundles.bundleCode, input.bundle_code)))
        .limit(1);
    if (dup[0]) {
        const err = new Error(`Bundle code '${input.bundle_code}' already exists in this shop`);
        (err as { status?: number }).status = 409;
        throw err;
    }

    const productIds = input.items.map((i) => i.product_id);
    await validateBundleProducts(shopId, productIds);

    // The dup check above is a fast, friendly pre-check — it isn't race-safe
    // on its own (two near-simultaneous requests, e.g. a double-tap on a
    // touchscreen POS, can both pass it before either commits). The
    // uq_product_bundles_shop_code DB constraint is the real backstop; a
    // race that slips past the pre-check surfaces here as 23505, which we
    // translate to the same friendly 409 instead of a raw 500.
    let bundleId: number;
    try {
        bundleId = await pgClient.begin(async (sqlTx) => {
            const ins = await sqlTx<Array<{ id: number }>>`
      INSERT INTO product_bundles
        (shop_id, bundle_code, barcode, name, description,
         external_price, internal_price, color, sort_order, is_active)
      VALUES (${shopId}, ${input.bundle_code}, ${input.barcode ?? null}, ${input.name},
              ${input.description ?? null}, ${input.external_price},
              ${input.internal_price ?? input.external_price},
              ${input.color ?? null}, 0, true)
      RETURNING id
    `;
            const newId = ins[0].id;
            for (let idx = 0; idx < input.items.length; idx++) {
                const it = input.items[idx];
                await sqlTx`
        INSERT INTO bundle_items (bundle_id, product_id, quantity, sort_order)
        VALUES (${newId}, ${it.product_id}, ${it.quantity}, ${idx})
      `;
            }
            return newId;
        });
    } catch (e) {
        if (isPgUniqueViolation(e)) {
            const err = new Error(`Bundle code '${input.bundle_code}' already exists in this shop`);
            (err as { status?: number }).status = 409;
            throw err;
        }
        throw e;
    }

    return getBundle(shopId, bundleId);
}

export interface UpdateBundleInput {
    bundle_code?: string | null;
    barcode?: string | null;
    name?: string | null;
    description?: string | null;
    external_price?: number | null;
    internal_price?: number | null;
    photo_url?: string | null;
    color?: string | null;
    is_active?: boolean | null;
    items?: BundleItemInput[] | null;
}

export async function updateBundle(
    shopId: string,
    bundleId: number,
    input: UpdateBundleInput,
): Promise<BundleDTO> {
    await assertShop(shopId);
    const cur = await db
        .select()
        .from(productBundles)
        .where(and(eq(productBundles.id, bundleId), eq(productBundles.shopId, shopId)))
        .limit(1);
    if (!cur[0]) {
        const err = new Error("Bundle not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    const bundle = cur[0];

    if (input.bundle_code && input.bundle_code !== bundle.bundleCode) {
        const dup = await db
            .select({ id: productBundles.id })
            .from(productBundles)
            .where(and(
                eq(productBundles.shopId, shopId),
                eq(productBundles.bundleCode, input.bundle_code),
                ne(productBundles.id, bundleId),
            ))
            .limit(1);
        if (dup[0]) {
            const err = new Error(`Bundle code '${input.bundle_code}' already exists`);
            (err as { status?: number }).status = 409;
            throw err;
        }
    }

    if (input.items !== undefined && input.items !== null) {
        await validateBundleProducts(shopId, input.items.map((i) => i.product_id));
    }

    const updates: Record<string, unknown> = {};
    if (input.bundle_code !== undefined && input.bundle_code !== null) updates.bundleCode = input.bundle_code;
    if (input.barcode !== undefined) updates.barcode = typeof input.barcode === "string" ? (input.barcode.trim() || null) : null;
    if (input.name !== undefined && input.name !== null) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.external_price !== undefined && input.external_price !== null) updates.externalPrice = String(input.external_price);
    if (input.internal_price !== undefined && input.internal_price !== null) updates.internalPrice = String(input.internal_price);
    if (input.photo_url !== undefined) updates.photoUrl = input.photo_url;
    if (input.color !== undefined) updates.color = input.color;
    if (input.is_active !== undefined && input.is_active !== null) updates.isActive = input.is_active;

    try {
        await pgClient.begin(async (sqlTx) => {
            if (Object.keys(updates).length > 0) {
                await db.update(productBundles).set(updates).where(eq(productBundles.id, bundleId));
            }
            if (input.items !== undefined && input.items !== null) {
                await sqlTx`DELETE FROM bundle_items WHERE bundle_id = ${bundleId}`;
                for (let idx = 0; idx < input.items.length; idx++) {
                    const it = input.items[idx];
                    await sqlTx`
          INSERT INTO bundle_items (bundle_id, product_id, quantity, sort_order)
          VALUES (${bundleId}, ${it.product_id}, ${it.quantity}, ${idx})
        `;
                }
            }
        });
    } catch (e) {
        if (isPgUniqueViolation(e)) {
            const err = new Error(`Bundle code '${input.bundle_code}' already exists`);
            (err as { status?: number }).status = 409;
            throw err;
        }
        throw e;
    }

    return getBundle(shopId, bundleId);
}

export async function deleteBundle(shopId: string, bundleId: number): Promise<{ success: true; message: string }> {
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
    await db.update(productBundles).set({ isActive: false }).where(eq(productBundles.id, bundleId));
    return { success: true, message: `Bundle '${rows[0].name}' deactivated` };
}

export async function reorderBundles(
    shopId: string,
    sortMap: Record<string, number>,
): Promise<{ success: true; updated: number }> {
    await assertShop(shopId);
    let updated = 0;
    await pgClient.begin(async (sqlTx) => {
        for (const [idStr, sortOrder] of Object.entries(sortMap)) {
            const id = Number(idStr);
            if (!Number.isInteger(id)) continue;
            const res = await sqlTx<Array<{ id: number }>>`
        UPDATE product_bundles SET sort_order = ${sortOrder}
        WHERE id = ${id} AND shop_id = ${shopId}
        RETURNING id
      `;
            if (res.length > 0) updated += 1;
        }
    });
    return { success: true, updated };
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
