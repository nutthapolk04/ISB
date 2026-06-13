import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
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
