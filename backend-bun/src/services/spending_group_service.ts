import { asc, eq, inArray, sql } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import { spendingGroups, shops, shopSpendingGroups } from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";

const CODE_RE = /^[a-z][a-z0-9_]{1,38}$/;

function sanitizeGrades(grades: string[] | undefined | null): string[] {
    if (!Array.isArray(grades)) return [];
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const raw of grades) {
        if (typeof raw !== "string") continue;
        const v = raw.trim();
        if (!v || seen.has(v)) continue;
        seen.add(v);
        cleaned.push(v);
    }
    return cleaned;
}

export interface SpendingGroupDTO {
    id: number;
    code: string;
    name_en: string;
    name_th: string;
    daily_limit: number;
    grades: string[];
    is_active: boolean;
    created_at: string;
    updated_at: string;
    linked_shop_count: number;
}

async function toDTO(g: typeof spendingGroups.$inferSelect): Promise<SpendingGroupDTO> {
    const count = await db
        .select({ n: sql<string>`COUNT(*)` })
        .from(shopSpendingGroups)
        .where(eq(shopSpendingGroups.spendingGroupId, g.id));
    return {
        id: g.id,
        code: g.code,
        name_en: g.nameEn,
        name_th: g.nameTh,
        daily_limit: pgNumber(g.dailyLimit) ?? 0,
        grades: Array.isArray(g.grades) ? g.grades : [],
        is_active: g.isActive,
        created_at: pgToIso(g.createdAt)!,
        updated_at: pgToIso(g.updatedAt)!,
        linked_shop_count: Number(count[0]?.n ?? 0),
    };
}

export async function listSpendingGroups(): Promise<SpendingGroupDTO[]> {
    const rows = await db.select().from(spendingGroups).orderBy(asc(spendingGroups.id));
    return Promise.all(rows.map(toDTO));
}

export async function getSpendingGroup(id: number): Promise<SpendingGroupDTO> {
    const rows = await db.select().from(spendingGroups).where(eq(spendingGroups.id, id)).limit(1);
    if (!rows[0]) {
        const err = new Error("Spending group not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    return toDTO(rows[0]);
}

export interface CreateSpendingGroupInput {
    code: string;
    name_en: string;
    name_th: string;
    daily_limit: number;
    grades?: string[];
    is_active?: boolean;
}

export async function createSpendingGroup(input: CreateSpendingGroupInput): Promise<SpendingGroupDTO> {
    if (!CODE_RE.test(input.code)) {
        const err = new Error("code must be snake_case: start with a lowercase letter, followed by lowercase letters, digits, or underscores (2-40 chars)");
        (err as { status?: number }).status = 422;
        throw err;
    }
    if (input.daily_limit <= 0) {
        const err = new Error("daily_limit must be > 0");
        (err as { status?: number }).status = 422;
        throw err;
    }
    const dup = await db.select({ id: spendingGroups.id }).from(spendingGroups).where(eq(spendingGroups.code, input.code)).limit(1);
    if (dup[0]) {
        const err = new Error(`A group with code '${input.code}' already exists`);
        (err as { status?: number; code?: string }).status = 409;
        (err as { code?: string }).code = "DUPLICATE_GROUP_CODE";
        throw err;
    }
    const [created] = await db
        .insert(spendingGroups)
        .values({
            code: input.code,
            nameEn: input.name_en,
            nameTh: input.name_th,
            dailyLimit: String(input.daily_limit),
            grades: sanitizeGrades(input.grades),
            isActive: input.is_active ?? true,
        })
        .returning();
    return toDTO(created);
}

export interface UpdateSpendingGroupInput {
    name_en?: string | null;
    name_th?: string | null;
    daily_limit?: number | null;
    grades?: string[] | null;
    is_active?: boolean | null;
}

export async function updateSpendingGroup(id: number, input: UpdateSpendingGroupInput): Promise<SpendingGroupDTO> {
    const rows = await db.select().from(spendingGroups).where(eq(spendingGroups.id, id)).limit(1);
    if (!rows[0]) {
        const err = new Error("Spending group not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    const updates: Record<string, unknown> = {};
    if (input.name_en !== undefined && input.name_en !== null) updates.nameEn = input.name_en;
    if (input.name_th !== undefined && input.name_th !== null) updates.nameTh = input.name_th;
    if (input.daily_limit !== undefined && input.daily_limit !== null) {
        if (input.daily_limit <= 0) {
            const err = new Error("daily_limit must be > 0");
            (err as { status?: number }).status = 422;
            throw err;
        }
        updates.dailyLimit = String(input.daily_limit);
    }
    if (input.grades !== undefined && input.grades !== null) updates.grades = sanitizeGrades(input.grades);
    if (input.is_active !== undefined && input.is_active !== null) updates.isActive = input.is_active;

    if (Object.keys(updates).length > 0) {
        await db.update(spendingGroups).set(updates).where(eq(spendingGroups.id, id));
    }
    const fresh = await db.select().from(spendingGroups).where(eq(spendingGroups.id, id)).limit(1);
    return toDTO(fresh[0]);
}

export async function deleteSpendingGroup(id: number): Promise<void> {
    const rows = await db.select().from(spendingGroups).where(eq(spendingGroups.id, id)).limit(1);
    if (!rows[0]) {
        const err = new Error("Spending group not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    const blocking = await db
        .select({ id: shops.id, name: shops.name })
        .from(shopSpendingGroups)
        .innerJoin(shops, eq(shops.id, shopSpendingGroups.shopId))
        .where(eq(shopSpendingGroups.spendingGroupId, id));
    if (blocking.length > 0) {
        const err = new Error(`Cannot delete — ${blocking.length} shop(s) still linked. Reassign them first.`);
        (err as { status?: number; code?: string; blocking?: unknown }).status = 409;
        (err as { code?: string }).code = "GROUP_HAS_LINKED_SHOPS";
        (err as { blocking?: unknown }).blocking = blocking;
        throw err;
    }
    await db.delete(spendingGroups).where(eq(spendingGroups.id, id));
}

// ── Shop assignment (FE Spending Groups page UX) ────────────────────────────
// A shop may now belong to more than one group (e.g. one group per grade
// band sharing the same canteen shops), so linkage is a many-to-many table.

export interface AssignableShopDTO {
    id: string;
    name: string;
    module: string;
    is_active: boolean;
    linked: boolean;
    linked_at: string | null;
}

/**
 * List every shop in the school with a flag indicating whether it's linked
 * to this group. Used by the "Linked Shops" modal so admins can see both
 * the current members AND non-members in one place.
 */
export async function listAssignableShops(groupId: number): Promise<AssignableShopDTO[]> {
    const group = await db.select({ id: spendingGroups.id }).from(spendingGroups).where(eq(spendingGroups.id, groupId)).limit(1);
    if (!group[0]) {
        const err = new Error("Spending group not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    const linkedRows = await db
        .select({ shopId: shopSpendingGroups.shopId, createdAt: shopSpendingGroups.createdAt })
        .from(shopSpendingGroups)
        .where(eq(shopSpendingGroups.spendingGroupId, groupId));
    const linkedAtByShop = new Map(linkedRows.map((r) => [r.shopId, r.createdAt]));

    const rows = await db
        .select({
            id: shops.id,
            name: shops.name,
            module: shops.module,
            isActive: shops.isActive,
        })
        .from(shops)
        .orderBy(asc(shops.module), asc(shops.name));
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        module: r.module,
        is_active: r.isActive,
        linked: linkedAtByShop.has(r.id),
        linked_at: pgToIso(linkedAtByShop.get(r.id) ?? null),
    }));
}

/**
 * Replace the set of shops linked to THIS group atomically (many-to-many —
 * a shop can independently belong to other groups too, untouched here):
 *   - Shops in `shopIds` not yet linked to this group → insert a row
 *   - Shops linked to this group but not in `shopIds`  → delete their row
 */
export async function setLinkedShops(groupId: number, shopIds: string[]): Promise<{ linked: number; unlinked: number }> {
    const group = await db.select({ id: spendingGroups.id }).from(spendingGroups).where(eq(spendingGroups.id, groupId)).limit(1);
    if (!group[0]) {
        const err = new Error("Spending group not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    // Validate every requested shop exists (avoid silent skips)
    if (shopIds.length > 0) {
        const found = await db
            .select({ id: shops.id })
            .from(shops)
            .where(inArray(shops.id, shopIds));
        if (found.length !== shopIds.length) {
            const known = new Set(found.map((r) => r.id));
            const missing = shopIds.filter((s) => !known.has(s));
            const err = new Error(`Unknown shop id(s): ${missing.join(", ")}`);
            (err as { status?: number }).status = 422;
            throw err;
        }
    }
    let linked = 0;
    let unlinked = 0;
    await pgClient.begin(async (sqlTx) => {
        const currentlyLinked = await sqlTx<Array<{ shop_id: string }>>`
      SELECT shop_id FROM shop_spending_groups WHERE spending_group_id = ${groupId}
    `;
        const newSet = new Set(shopIds);
        const currentSet = new Set(currentlyLinked.map((r) => r.shop_id));
        const toUnlink = [...currentSet].filter((id) => !newSet.has(id));
        const toLink = shopIds.filter((id) => !currentSet.has(id));

        if (toUnlink.length > 0) {
            await sqlTx`
        DELETE FROM shop_spending_groups
        WHERE spending_group_id = ${groupId} AND shop_id IN ${sqlTx(toUnlink)}
      `;
            unlinked = toUnlink.length;
        }
        if (toLink.length > 0) {
            for (const shopId of toLink) {
                await sqlTx`
          INSERT INTO shop_spending_groups (shop_id, spending_group_id)
          VALUES (${shopId}, ${groupId})
        `;
            }
            linked = toLink.length;
        }
    });
    return { linked, unlinked };
}

// ── Group assignment from the shop's side (shop create/edit form) ──────────
// Same many-to-many table as above, just queried/written from the opposite
// direction — a shop is created/edited once and needs to pick its group(s)
// in that same flow, rather than an admin picking shops per-group.

export interface AssignableGroupDTO {
    id: number;
    code: string;
    name_en: string;
    name_th: string;
    is_active: boolean;
    linked: boolean;
}

/** All active spending groups, flagged with whether this shop currently belongs to each. */
export async function listGroupsForShop(shopId: string): Promise<AssignableGroupDTO[]> {
    const shopRows = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).limit(1);
    if (!shopRows[0]) {
        const err = new Error("Shop not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    const linkedRows = await db
        .select({ groupId: shopSpendingGroups.spendingGroupId })
        .from(shopSpendingGroups)
        .where(eq(shopSpendingGroups.shopId, shopId));
    const linkedIds = new Set(linkedRows.map((r) => r.groupId));

    const rows = await db.select().from(spendingGroups).orderBy(asc(spendingGroups.code));
    return rows.map((g) => ({
        id: g.id,
        code: g.code,
        name_en: g.nameEn,
        name_th: g.nameTh,
        is_active: g.isActive,
        linked: linkedIds.has(g.id),
    }));
}

/**
 * Replace the set of groups THIS shop belongs to atomically (many-to-many —
 * other shops in each group are untouched):
 *   - Groups in `groupIds` not yet linked to this shop → insert a row
 *   - Groups linked to this shop but not in `groupIds`  → delete their row
 */
export async function setGroupsForShop(shopId: string, groupIds: number[]): Promise<{ linked: number; unlinked: number }> {
    const shopRows = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).limit(1);
    if (!shopRows[0]) {
        const err = new Error("Shop not found");
        (err as { status?: number }).status = 404;
        throw err;
    }
    if (groupIds.length > 0) {
        const found = await db.select({ id: spendingGroups.id }).from(spendingGroups).where(inArray(spendingGroups.id, groupIds));
        if (found.length !== groupIds.length) {
            const known = new Set(found.map((r) => r.id));
            const missing = groupIds.filter((id) => !known.has(id));
            const err = new Error(`Unknown spending group id(s): ${missing.join(", ")}`);
            (err as { status?: number }).status = 422;
            throw err;
        }
    }
    let linked = 0;
    let unlinked = 0;
    await pgClient.begin(async (sqlTx) => {
        const currentlyLinked = await sqlTx<Array<{ spending_group_id: number }>>`
      SELECT spending_group_id FROM shop_spending_groups WHERE shop_id = ${shopId}
    `;
        const newSet = new Set(groupIds);
        const currentSet = new Set(currentlyLinked.map((r) => r.spending_group_id));
        const toUnlink = [...currentSet].filter((id) => !newSet.has(id));
        const toLink = groupIds.filter((id) => !currentSet.has(id));

        if (toUnlink.length > 0) {
            await sqlTx`
        DELETE FROM shop_spending_groups
        WHERE shop_id = ${shopId} AND spending_group_id IN ${sqlTx(toUnlink)}
      `;
            unlinked = toUnlink.length;
        }
        if (toLink.length > 0) {
            for (const groupId of toLink) {
                await sqlTx`
          INSERT INTO shop_spending_groups (shop_id, spending_group_id)
          VALUES (${shopId}, ${groupId})
        `;
            }
            linked = toLink.length;
        }
    });
    return { linked, unlinked };
}
