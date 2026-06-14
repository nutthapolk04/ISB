import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import { spendingGroups, shops } from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";

const CODE_RE = /^[a-z][a-z0-9_]{1,38}$/;

export interface SpendingGroupDTO {
  id: number;
  code: string;
  name_en: string;
  name_th: string;
  daily_limit: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  linked_shop_count: number;
}

async function toDTO(g: typeof spendingGroups.$inferSelect): Promise<SpendingGroupDTO> {
  const count = await db
    .select({ n: sql<string>`COUNT(*)` })
    .from(shops)
    .where(eq(shops.spendingGroupId, g.id));
  return {
    id: g.id,
    code: g.code,
    name_en: g.nameEn,
    name_th: g.nameTh,
    daily_limit: pgNumber(g.dailyLimit) ?? 0,
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
      isActive: input.is_active ?? true,
    })
    .returning();
  return toDTO(created);
}

export interface UpdateSpendingGroupInput {
  name_en?: string | null;
  name_th?: string | null;
  daily_limit?: number | null;
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
  const blocking = await db.select({ id: shops.id, name: shops.name }).from(shops).where(eq(shops.spendingGroupId, id));
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

export interface AssignableShopDTO {
  id: string;
  name: string;
  module: string;
  is_active: boolean;
  linked: boolean;
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
  const rows = await db
    .select({
      id: shops.id,
      name: shops.name,
      module: shops.module,
      isActive: shops.isActive,
      spendingGroupId: shops.spendingGroupId,
    })
    .from(shops)
    .orderBy(asc(shops.module), asc(shops.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    module: r.module,
    is_active: r.isActive,
    linked: r.spendingGroupId === groupId,
  }));
}

/**
 * Replace the set of shops linked to this group atomically:
 *   - Shops in `shopIds` whose spending_group_id ≠ groupId → set to groupId
 *   - Shops currently linked but not in `shopIds`           → set to NULL
 * Other shops untouched.
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
    // Unlink shops currently in group but not in the new set
    const currentlyLinked = await sqlTx<Array<{ id: string }>>`
      SELECT id FROM shops WHERE spending_group_id = ${groupId}
    `;
    const newSet = new Set(shopIds);
    const toUnlink = currentlyLinked.map((r) => r.id).filter((id) => !newSet.has(id));
    if (toUnlink.length > 0) {
      await sqlTx`UPDATE shops SET spending_group_id = NULL, updated_at = NOW() WHERE id IN ${sqlTx(toUnlink)}`;
      unlinked = toUnlink.length;
    }
    // Link shops in the new set that aren't already linked here
    if (shopIds.length > 0) {
      const result = await sqlTx<Array<{ id: string }>>`
        UPDATE shops SET spending_group_id = ${groupId}, updated_at = NOW()
        WHERE id IN ${sqlTx(shopIds)} AND (spending_group_id IS NULL OR spending_group_id <> ${groupId})
        RETURNING id
      `;
      linked = result.length;
    }
  });
  return { linked, unlinked };
}
