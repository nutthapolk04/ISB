import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { unitsOfMeasure, shopProducts } from "@/db/schema";
import { pgNumber } from "@/lib/dates";

export interface UOMResponseDTO {
  id: number;
  code: string;
  name: string;
  name_en: string | null;
  base_uom_id: number | null;
  conversion_factor: number;
  is_active: boolean;
  base_uom_code: string | null;
  base_uom_name: string | null;
}

async function toDTO(uom: typeof unitsOfMeasure.$inferSelect): Promise<UOMResponseDTO> {
  let baseCode: string | null = null;
  let baseName: string | null = null;
  if (uom.baseUomId !== null) {
    const base = await db.select({ code: unitsOfMeasure.code, name: unitsOfMeasure.name }).from(unitsOfMeasure).where(eq(unitsOfMeasure.id, uom.baseUomId)).limit(1);
    baseCode = base[0]?.code ?? null;
    baseName = base[0]?.name ?? null;
  }
  return {
    id: uom.id,
    code: uom.code,
    name: uom.name,
    name_en: uom.nameEn ?? null,
    base_uom_id: uom.baseUomId ?? null,
    conversion_factor: pgNumber(uom.conversionFactor) ?? 1,
    is_active: uom.isActive,
    base_uom_code: baseCode,
    base_uom_name: baseName,
  };
}

export async function listUoms(activeOnly = true): Promise<UOMResponseDTO[]> {
  const rows = await db
    .select()
    .from(unitsOfMeasure)
    .where(activeOnly ? eq(unitsOfMeasure.isActive, true) : undefined)
    .orderBy(asc(unitsOfMeasure.code));
  return Promise.all(rows.map(toDTO));
}

export async function getUom(id: number): Promise<UOMResponseDTO> {
  const rows = await db.select().from(unitsOfMeasure).where(eq(unitsOfMeasure.id, id)).limit(1);
  if (!rows[0]) {
    const err = new Error("UOM not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  return toDTO(rows[0]);
}

export interface CreateUomInput {
  code: string;
  name: string;
  name_en?: string | null;
  base_uom_id?: number | null;
  conversion_factor?: number;
}

export async function createUom(input: CreateUomInput): Promise<UOMResponseDTO> {
  const code = input.code.toUpperCase();
  const dup = await db.select({ id: unitsOfMeasure.id }).from(unitsOfMeasure).where(eq(unitsOfMeasure.code, code)).limit(1);
  if (dup[0]) {
    const err = new Error(`UOM code '${input.code}' already exists`);
    (err as { status?: number }).status = 409;
    throw err;
  }
  if (input.base_uom_id !== undefined && input.base_uom_id !== null) {
    const base = await db.select({ id: unitsOfMeasure.id }).from(unitsOfMeasure).where(eq(unitsOfMeasure.id, input.base_uom_id)).limit(1);
    if (!base[0]) {
      const err = new Error("Base UOM not found");
      (err as { status?: number }).status = 400;
      throw err;
    }
  }
  const [created] = await db
    .insert(unitsOfMeasure)
    .values({
      code,
      name: input.name,
      nameEn: input.name_en ?? null,
      baseUomId: input.base_uom_id ?? null,
      conversionFactor: String(input.conversion_factor ?? 1),
      isActive: true,
    })
    .returning();
  return toDTO(created);
}

export interface UpdateUomInput {
  code?: string | null;
  name?: string | null;
  name_en?: string | null;
  base_uom_id?: number | null;
  conversion_factor?: number | null;
  is_active?: boolean | null;
}

export async function updateUom(id: number, input: UpdateUomInput): Promise<UOMResponseDTO> {
  const rows = await db.select().from(unitsOfMeasure).where(eq(unitsOfMeasure.id, id)).limit(1);
  if (!rows[0]) {
    const err = new Error("UOM not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  const updates: Record<string, unknown> = {};
  if (input.code !== undefined && input.code !== null) {
    const code = input.code.toUpperCase();
    const dup = await db
      .select({ id: unitsOfMeasure.id })
      .from(unitsOfMeasure)
      .where(and(eq(unitsOfMeasure.code, code), ne(unitsOfMeasure.id, id)))
      .limit(1);
    if (dup[0]) {
      const err = new Error(`UOM code '${input.code}' already exists`);
      (err as { status?: number }).status = 409;
      throw err;
    }
    updates.code = code;
  }
  if (input.name !== undefined && input.name !== null) updates.name = input.name;
  if (input.name_en !== undefined) updates.nameEn = input.name_en;
  if (input.base_uom_id !== undefined && input.base_uom_id !== null) {
    if (input.base_uom_id !== 0) {
      const base = await db.select({ id: unitsOfMeasure.id }).from(unitsOfMeasure).where(eq(unitsOfMeasure.id, input.base_uom_id)).limit(1);
      if (!base[0]) {
        const err = new Error("Base UOM not found");
        (err as { status?: number }).status = 400;
        throw err;
      }
      updates.baseUomId = input.base_uom_id;
    } else {
      updates.baseUomId = null;
    }
  }
  if (input.conversion_factor !== undefined && input.conversion_factor !== null) updates.conversionFactor = String(input.conversion_factor);
  if (input.is_active !== undefined && input.is_active !== null) updates.isActive = input.is_active;

  if (Object.keys(updates).length > 0) {
    await db.update(unitsOfMeasure).set(updates).where(eq(unitsOfMeasure.id, id));
  }
  const fresh = await db.select().from(unitsOfMeasure).where(eq(unitsOfMeasure.id, id)).limit(1);
  return toDTO(fresh[0]);
}

export async function deleteUom(id: number): Promise<{ success: true }> {
  const rows = await db.select({ id: unitsOfMeasure.id }).from(unitsOfMeasure).where(eq(unitsOfMeasure.id, id)).limit(1);
  if (!rows[0]) {
    const err = new Error("UOM not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  // Check if any product uses this UOM
  const inUse = await db.select({ id: shopProducts.id }).from(shopProducts).where(eq(shopProducts.uomId, id)).limit(1);
  if (inUse[0]) {
    const err = new Error("Cannot delete — UOM in use by one or more products");
    (err as { status?: number }).status = 409;
    throw err;
  }
  // Soft-delete by setting is_active=false (matches FastAPI behaviour)
  await db.update(unitsOfMeasure).set({ isActive: false }).where(eq(unitsOfMeasure.id, id));
  return { success: true };
}
