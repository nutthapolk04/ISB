import { eq, and, or, ilike, asc } from "drizzle-orm";
import { db } from "@/db/client";
import {
    products,
    productVariants,
    categories,
    stockLevels,
} from "@/db/schema";
import { pgToIso, pgNumber } from "@/lib/dates";

export interface CategoryDTO {
    id: number;
    name: string;
    description: string | null;
    parent_id: number | null;
    is_active: boolean;
    created_at: string;
    updated_at: string | null;
}

export interface ProductVariantDTO {
    id: number;
    product_id: number;
    sku: string;
    variant_name: string;
    color: string | null;
    size: string | null;
    barcode: string | null;
    cost_price: number;
    retail_price: number;
    image_url: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string | null;
    stock_quantity: number | null;
}

export interface ProductDTO {
    id: number;
    name: string;
    description: string | null;
    category_id: number;
    brand: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string | null;
    category: CategoryDTO | null;
    variants: ProductVariantDTO[];
}

export interface ListProductsFilters {
    skip?: number;
    limit?: number;
    categoryId?: number;
    isActive?: boolean;
}

export async function listProducts(filters: ListProductsFilters = {}): Promise<ProductDTO[]> {
    const skip = filters.skip ?? 0;
    const limit = Math.min(filters.limit ?? 20, 100);

    const where = [];
    if (filters.categoryId !== undefined) where.push(eq(products.categoryId, filters.categoryId));
    if (filters.isActive !== undefined) where.push(eq(products.isActive, filters.isActive));

    const rows = await db
        .select()
        .from(products)
        .where(where.length > 0 ? and(...where) : undefined)
        .orderBy(asc(products.id))
        .limit(limit)
        .offset(skip);

    return Promise.all(rows.map(hydrateProduct));
}

export async function getProduct(productId: number): Promise<ProductDTO | null> {
    const rows = await db.select().from(products).where(eq(products.id, productId)).limit(1);
    if (!rows[0]) return null;
    return hydrateProduct(rows[0]);
}

/**
 * Mirror FastAPI /products/search — first try exact barcode, then fallback to
 * partial match on name / SKU. Returns variant rows (not products).
 */
export async function searchProducts(
    q: string,
    skip = 0,
    limit = 20,
): Promise<ProductVariantDTO[]> {
    // Exact barcode first
    const byBarcode = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.barcode, q))
        .limit(1);
    if (byBarcode[0]) {
        return [await hydrateVariant(byBarcode[0])];
    }

    // Partial match on variant_name or sku
    const pattern = `%${q}%`;
    const matches = await db
        .select()
        .from(productVariants)
        .where(or(ilike(productVariants.variantName, pattern), ilike(productVariants.sku, pattern)))
        .orderBy(asc(productVariants.id))
        .limit(Math.min(limit, 100))
        .offset(skip);

    return Promise.all(matches.map(hydrateVariant));
}

export async function getVariantByBarcode(barcode: string): Promise<ProductVariantDTO | null> {
    const rows = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.barcode, barcode))
        .limit(1);
    return rows[0] ? await hydrateVariant(rows[0]) : null;
}

// ── Hydrators ───────────────────────────────────────────────────────────────

async function hydrateProduct(row: typeof products.$inferSelect): Promise<ProductDTO> {
    const [categoryRow, variants] = await Promise.all([
        db.select().from(categories).where(eq(categories.id, row.categoryId)).limit(1),
        db.select().from(productVariants).where(eq(productVariants.productId, row.id)),
    ]);

    const hydratedVariants = await Promise.all(variants.map(hydrateVariant));

    return {
        id: row.id,
        name: row.name,
        description: row.description ?? null,
        category_id: row.categoryId,
        brand: row.brand ?? null,
        is_active: row.isActive,
        created_at: pgToIso(row.createdAt)!,
        updated_at: pgToIso(row.updatedAt),
        category: categoryRow[0] ? toCategoryDTO(categoryRow[0]) : null,
        variants: hydratedVariants,
    };
}

async function hydrateVariant(row: typeof productVariants.$inferSelect): Promise<ProductVariantDTO> {
    const stockRows = await db
        .select()
        .from(stockLevels)
        .where(eq(stockLevels.productVariantId, row.id))
        .limit(1);

    return {
        id: row.id,
        product_id: row.productId,
        sku: row.sku,
        variant_name: row.variantName,
        color: row.color ?? null,
        size: row.size ?? null,
        barcode: row.barcode ?? null,
        cost_price: pgNumber(row.costPrice) ?? 0,
        retail_price: pgNumber(row.retailPrice) ?? 0,
        image_url: row.imageUrl ?? null,
        is_active: row.isActive,
        created_at: pgToIso(row.createdAt)!,
        updated_at: pgToIso(row.updatedAt),
        stock_quantity: stockRows[0]?.quantity ?? null,
    };
}

function toCategoryDTO(row: typeof categories.$inferSelect): CategoryDTO {
    return {
        id: row.id,
        name: row.name,
        description: row.description ?? null,
        parent_id: row.parentId ?? null,
        is_active: row.isActive,
        created_at: pgToIso(row.createdAt)!,
        updated_at: pgToIso(row.updatedAt),
    };
}
