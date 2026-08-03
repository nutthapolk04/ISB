import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { pricePanels, pricePanelItems, shopProducts, productBundles } from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";

export interface PricePanelDTO {
    id: number;
    shop_id: string;
    name: string;
    color: string | null;
    sort_order: number;
    created_at: string;
}

export interface PricePanelItemDTO {
    kind: "product" | "bundle";
    product_id: number;
    bundle_id: number | null;
    product_code: string;
    product_name: string;
    external_price: number;
    panel_price: number | null;
    short_name: string | null;
    included: boolean;
    is_bundle: boolean;
}

async function getPanelOr404(shopId: string, panelId: number): Promise<typeof pricePanels.$inferSelect> {
    const rows = await db
        .select()
        .from(pricePanels)
        .where(and(eq(pricePanels.id, panelId), eq(pricePanels.shopId, shopId)))
        .limit(1);
    if (!rows[0]) {
        const err = new Error("Price panel not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    return rows[0];
}

function toPanelDTO(p: typeof pricePanels.$inferSelect): PricePanelDTO {
    return {
        id: p.id,
        shop_id: p.shopId,
        name: p.name,
        color: p.color ?? null,
        sort_order: p.sortOrder,
        created_at: pgToIso(p.createdAt)!,
    };
}

export async function listPanels(shopId: string): Promise<PricePanelDTO[]> {
    const rows = await db
        .select()
        .from(pricePanels)
        .where(eq(pricePanels.shopId, shopId))
        .orderBy(asc(pricePanels.sortOrder), asc(pricePanels.id));
    return rows.map(toPanelDTO);
}

export async function createPanel(shopId: string, name: string, color: string | null): Promise<PricePanelDTO> {
    const [created] = await db
        .insert(pricePanels)
        .values({ shopId, name, color, sortOrder: 0 })
        .returning();
    return toPanelDTO(created);
}

export async function updatePanel(
    shopId: string,
    panelId: number,
    input: { name?: string | null; color?: string | null; sort_order?: number | null },
): Promise<PricePanelDTO> {
    await getPanelOr404(shopId, panelId);
    const updates: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== null) updates.name = input.name;
    if (input.color !== undefined && input.color !== null) updates.color = input.color;
    if (input.sort_order !== undefined && input.sort_order !== null) updates.sortOrder = input.sort_order;
    if (Object.keys(updates).length > 0) {
        await db.update(pricePanels).set(updates).where(eq(pricePanels.id, panelId));
    }
    const fresh = await db.select().from(pricePanels).where(eq(pricePanels.id, panelId)).limit(1);
    return toPanelDTO(fresh[0]);
}

export async function deletePanel(shopId: string, panelId: number): Promise<void> {
    await getPanelOr404(shopId, panelId);
    await db.delete(pricePanels).where(eq(pricePanels.id, panelId));
}

export async function getPanelItems(shopId: string, panelId: number): Promise<PricePanelItemDTO[]> {
    await getPanelOr404(shopId, panelId);

    const products = await db
        .select()
        .from(shopProducts)
        .where(and(eq(shopProducts.shopId, shopId), eq(shopProducts.isActive, true)))
        .orderBy(asc(shopProducts.sortOrder), asc(shopProducts.id));

    const bundles = await db
        .select()
        .from(productBundles)
        .where(and(eq(productBundles.shopId, shopId), eq(productBundles.isActive, true)))
        .orderBy(asc(productBundles.sortOrder), asc(productBundles.id));

    const panelItems = await db
        .select({
            id: pricePanelItems.id,
            panelId: pricePanelItems.panelId,
            productId: pricePanelItems.productId,
            bundleId: pricePanelItems.bundleId,
            price: pricePanelItems.price,
            shortName: pricePanelItems.shortName,
            included: pricePanelItems.included,
            sortOrder: pricePanelItems.sortOrder,
        })
        .from(pricePanelItems)
        .where(eq(pricePanelItems.panelId, panelId))
        .orderBy(asc(pricePanelItems.sortOrder), asc(pricePanelItems.id));

    type PanelItemRow = { id: number; panelId: number; productId: number | null; bundleId: number | null; price: string | null; shortName: string | null; included: boolean; sortOrder: number };
    const productMap = new Map<number, PanelItemRow>();
    const bundleMap = new Map<number, PanelItemRow>();
    for (const it of panelItems) {
        if (it.bundleId !== null) bundleMap.set(it.bundleId, it);
        else if (it.productId !== null) productMap.set(it.productId, it);
    }

    // Fallback ordering when a panel item has never been explicitly reordered
    // (sort_order === 0): fall back to the global shop_products / product_bundles
    // sort order. Products come first, then bundles, matching legacy behavior —
    // this is only the tiebreak/fallback tier, not the primary order.
    let globalIndexCounter = 0;
    const productGlobalIndex = new Map<number, number>();
    for (const p of products) productGlobalIndex.set(p.id, globalIndexCounter++);
    const bundleGlobalIndex = new Map<number, number>();
    for (const b of bundles) bundleGlobalIndex.set(b.id, globalIndexCounter++);

    type InternalItem = PricePanelItemDTO & { _sortOrder: number; _globalIndex: number };
    const out: InternalItem[] = [];
    for (const p of products) {
        const r = productMap.get(p.id);
        if (!r) continue;
        out.push({
            kind: "product",
            product_id: p.id,
            bundle_id: null,
            product_code: p.productCode,
            product_name: p.name,
            external_price: pgNumber(p.externalPrice) ?? 0,
            panel_price: r?.price !== undefined && r?.price !== null ? pgNumber(r.price) : null,
            short_name: r?.shortName ?? null,
            included: r ? r.included : false,
            is_bundle: false,
            _sortOrder: r.sortOrder,
            _globalIndex: productGlobalIndex.get(p.id) ?? globalIndexCounter,
        });
    }
    for (const b of bundles) {
        const r = bundleMap.get(b.id);
        if (!r) continue;
        out.push({
            kind: "bundle",
            product_id: b.id,
            bundle_id: b.id,
            product_code: b.bundleCode,
            product_name: b.name,
            external_price: pgNumber(b.externalPrice) ?? 0,
            panel_price: r?.price !== undefined && r?.price !== null ? pgNumber(r.price) : null,
            short_name: r?.shortName ?? null,
            included: r ? r.included : false,
            is_bundle: true,
            _sortOrder: r.sortOrder,
            _globalIndex: bundleGlobalIndex.get(b.id) ?? globalIndexCounter,
        });
    }

    // Order by the panel's own custom sort_order first (0 = never reordered,
    // so it falls back to the global product/bundle order instead of being
    // pinned to the front), then by global order as the tiebreak.
    out.sort((a, b) => {
        const aKey = a._sortOrder === 0 ? Number.POSITIVE_INFINITY : a._sortOrder;
        const bKey = b._sortOrder === 0 ? Number.POSITIVE_INFINITY : b._sortOrder;
        if (aKey !== bKey) return aKey - bKey;
        return a._globalIndex - b._globalIndex;
    });

    return out.map(({ _sortOrder, _globalIndex, ...rest }) => rest);
}

export interface PanelItemPatchInput {
    price?: number | null;
    short_name?: string | null;
    included?: boolean | null;
}

export async function setItemPrice(
    shopId: string,
    panelId: number,
    productId: number,
    input: PanelItemPatchInput,
): Promise<PricePanelItemDTO> {
    await getPanelOr404(shopId, panelId);
    const pRows = await db
        .select()
        .from(shopProducts)
        .where(and(eq(shopProducts.id, productId), eq(shopProducts.shopId, shopId)))
        .limit(1);
    const product = pRows[0];
    if (!product) {
        const err = new Error("Product not found");
        (err as { status?: number }).status = 404;
        throw err;
    }

    const existing = await db
        .select()
        .from(pricePanelItems)
        .where(and(eq(pricePanelItems.panelId, panelId), eq(pricePanelItems.productId, productId)))
        .limit(1);

    const normalisedShort = input.short_name !== undefined
        ? (typeof input.short_name === "string" && input.short_name.trim() ? input.short_name.trim() : null)
        : undefined;

    let finalPrice: string | null = input.price !== undefined && input.price !== null ? String(input.price) : null;
    let finalShort: string | null = normalisedShort ?? null;
    let finalIncluded = true;

    if (existing[0]) {
        const updates: Record<string, unknown> = {};
        if (input.price !== undefined) updates.price = input.price !== null ? String(input.price) : null;
        if (input.short_name !== undefined) updates.shortName = normalisedShort;
        if (input.included !== undefined && input.included !== null) updates.included = input.included;
        if (Object.keys(updates).length > 0) {
            await db.update(pricePanelItems).set(updates).where(eq(pricePanelItems.id, existing[0].id));
        }
        finalPrice = updates.price !== undefined ? (updates.price as string | null) : existing[0].price ?? null;
        finalShort = normalisedShort !== undefined ? normalisedShort : existing[0].shortName ?? null;
        finalIncluded = input.included !== undefined && input.included !== null ? input.included : existing[0].included;
    } else {
        finalIncluded = input.included !== undefined && input.included !== null ? input.included : true;
        await db.insert(pricePanelItems).values({
            panelId,
            productId,
            price: finalPrice,
            shortName: finalShort,
            included: finalIncluded,
        });
    }

    return {
        kind: "product",
        product_id: product.id,
        bundle_id: null,
        product_code: product.productCode,
        product_name: product.name,
        external_price: pgNumber(product.externalPrice) ?? 0,
        panel_price: finalPrice !== null ? pgNumber(finalPrice) : null,
        short_name: finalShort,
        included: finalIncluded,
        is_bundle: false,
    };
}

export async function setBundleItemPrice(
    shopId: string,
    panelId: number,
    bundleId: number,
    input: PanelItemPatchInput,
): Promise<PricePanelItemDTO> {
    await getPanelOr404(shopId, panelId);
    const bRows = await db
        .select()
        .from(productBundles)
        .where(and(eq(productBundles.id, bundleId), eq(productBundles.shopId, shopId)))
        .limit(1);
    const bundle = bRows[0];
    if (!bundle) {
        const err = new Error("Bundle not found");
        (err as { status?: number }).status = 404;
        throw err;
    }

    const existing = await db
        .select()
        .from(pricePanelItems)
        .where(and(eq(pricePanelItems.panelId, panelId), eq(pricePanelItems.bundleId, bundleId)))
        .limit(1);

    const normalisedShort = input.short_name !== undefined
        ? (typeof input.short_name === "string" && input.short_name.trim() ? input.short_name.trim() : null)
        : undefined;

    let finalPrice: string | null = input.price !== undefined && input.price !== null ? String(input.price) : null;
    let finalShort: string | null = normalisedShort ?? null;
    let finalIncluded = true;

    if (existing[0]) {
        const updates: Record<string, unknown> = {};
        if (input.price !== undefined) updates.price = input.price !== null ? String(input.price) : null;
        if (input.short_name !== undefined) updates.shortName = normalisedShort;
        if (input.included !== undefined && input.included !== null) updates.included = input.included;
        if (Object.keys(updates).length > 0) {
            await db.update(pricePanelItems).set(updates).where(eq(pricePanelItems.id, existing[0].id));
        }
        finalPrice = updates.price !== undefined ? (updates.price as string | null) : existing[0].price ?? null;
        finalShort = normalisedShort !== undefined ? normalisedShort : existing[0].shortName ?? null;
        finalIncluded = input.included !== undefined && input.included !== null ? input.included : existing[0].included;
    } else {
        finalIncluded = input.included !== undefined && input.included !== null ? input.included : true;
        await db.insert(pricePanelItems).values({
            panelId,
            bundleId,
            price: finalPrice,
            shortName: finalShort,
            included: finalIncluded,
        });
    }

    return {
        kind: "bundle",
        product_id: bundle.id,
        bundle_id: bundle.id,
        product_code: bundle.bundleCode,
        product_name: bundle.name,
        external_price: pgNumber(bundle.externalPrice) ?? 0,
        panel_price: finalPrice !== null ? pgNumber(finalPrice) : null,
        short_name: finalShort,
        included: finalIncluded,
        is_bundle: true,
    };
}

export async function reorderPanelItems(
    shopId: string,
    panelId: number,
    sortMap: Record<string, number>,
): Promise<{ success: true; updated: number }> {
    await getPanelOr404(shopId, panelId);
    let updated = 0;
    for (const [idStr, sortOrder] of Object.entries(sortMap)) {
        const productId = Number(idStr);
        if (!Number.isInteger(productId)) continue;
        const res = await db
            .update(pricePanelItems)
            .set({ sortOrder })
            .where(and(eq(pricePanelItems.panelId, panelId), eq(pricePanelItems.productId, productId)))
            .returning({ id: pricePanelItems.id });
        if (res.length > 0) {
            updated++;
            continue;
        }
        // Bundle rows have product_id = NULL and use bundle_id instead — retry
        // treating the id as a bundle_id so dragging a bundle inside a panel
        // also persists.
        const bundleRes = await db
            .update(pricePanelItems)
            .set({ sortOrder })
            .where(and(eq(pricePanelItems.panelId, panelId), eq(pricePanelItems.bundleId, productId)))
            .returning({ id: pricePanelItems.id });
        if (bundleRes.length > 0) updated++;
    }
    return { success: true, updated };
}
