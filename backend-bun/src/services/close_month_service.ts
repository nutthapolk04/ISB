import { and, desc, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db, pgClient } from "@/db/client";
import {
  stockPeriodCloses,
  stockPeriodCloseItems,
  shopProducts,
} from "@/db/schema";

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CloseItemDTO {
  id: number;
  product_id: number;
  product_name: string;
  system_qty: number;
  physical_qty: number | null;
  variance_qty: number | null;
  unit_cost: string | null;
  variance_value: string | null;
  adjustment_movement_id: number | null;
}

export interface CloseDTO {
  id: number;
  shop_id: string;
  period_year: number;
  period_month: number;
  status: string;
  closed_by: number | null;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
  items: CloseItemDTO[];
  has_backdated_movements: boolean;
}

export interface CloseSummaryDTO {
  id: number;
  shop_id: string;
  period_year: number;
  period_month: number;
  status: string;
  closed_by: number | null;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function err(msg: string, status: number): Error {
  return Object.assign(new Error(msg), { status });
}

function csvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function fetchItems(closeId: number): Promise<CloseItemDTO[]> {
  const rows = await db
    .select({
      id: stockPeriodCloseItems.id,
      product_id: stockPeriodCloseItems.productId,
      product_name: shopProducts.name,
      system_qty: stockPeriodCloseItems.systemQty,
      physical_qty: stockPeriodCloseItems.physicalQty,
      variance_qty: stockPeriodCloseItems.varianceQty,
      unit_cost: stockPeriodCloseItems.unitCost,
      variance_value: stockPeriodCloseItems.varianceValue,
      adjustment_movement_id: stockPeriodCloseItems.adjustmentMovementId,
    })
    .from(stockPeriodCloseItems)
    .leftJoin(shopProducts, eq(stockPeriodCloseItems.productId, shopProducts.id))
    .where(eq(stockPeriodCloseItems.closeId, closeId))
    .orderBy(shopProducts.name);

  return rows.map((r) => ({
    ...r,
    product_name: r.product_name ?? `product#${r.product_id}`,
  }));
}

async function hasBackdatedMovements(closeId: number): Promise<boolean> {
  const [close] = await db
    .select({
      shopId: stockPeriodCloses.shopId,
      year: stockPeriodCloses.periodYear,
      month: stockPeriodCloses.periodMonth,
      createdAt: stockPeriodCloses.createdAt,
    })
    .from(stockPeriodCloses)
    .where(eq(stockPeriodCloses.id, closeId))
    .limit(1);
  if (!close) return false;

  const rows = await pgClient<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM shop_movements
    WHERE shop_id = ${close.shopId}
      AND DATE_PART('year', date::date) = ${close.year}
      AND DATE_PART('month', date::date) = ${close.month}
      AND created_at > ${close.createdAt}
    LIMIT 1
  `;
  return parseInt(rows[0]?.count ?? "0", 10) > 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function listCloses(shopId: string): Promise<CloseSummaryDTO[]> {
  const rows = await db
    .select()
    .from(stockPeriodCloses)
    .where(eq(stockPeriodCloses.shopId, shopId))
    .orderBy(desc(stockPeriodCloses.periodYear), desc(stockPeriodCloses.periodMonth));
  return rows.map((r) => ({
    id: r.id,
    shop_id: r.shopId,
    period_year: r.periodYear,
    period_month: r.periodMonth,
    status: r.status,
    closed_by: r.closedBy,
    closed_at: r.closedAt,
    notes: r.notes,
    created_at: r.createdAt,
  }));
}

export async function createClose(
  shopId: string,
  periodYear: number,
  periodMonth: number,
): Promise<CloseDTO> {
  const [close] = await db
    .insert(stockPeriodCloses)
    .values({ shopId, periodYear, periodMonth, status: "draft" })
    .onConflictDoNothing()
    .returning();
  if (!close) throw err("Period already exists for this shop and month", 409);

  const products = await db
    .select({ id: shopProducts.id, stock: shopProducts.stock, avgCost: shopProducts.avgCost })
    .from(shopProducts)
    .where(and(eq(shopProducts.shopId, shopId), eq(shopProducts.isActive, true)));

  if (products.length > 0) {
    await db.insert(stockPeriodCloseItems).values(
      products.map((p) => ({
        closeId: close.id,
        productId: p.id,
        systemQty: p.stock,
        unitCost: p.avgCost,
      })),
    );
  }

  return getClose(close.id);
}

export async function getClose(closeId: number): Promise<CloseDTO> {
  const [close] = await db
    .select()
    .from(stockPeriodCloses)
    .where(eq(stockPeriodCloses.id, closeId))
    .limit(1);
  if (!close) throw err("Close period not found", 404);

  const [items, backdated] = await Promise.all([
    fetchItems(closeId),
    hasBackdatedMovements(closeId),
  ]);

  return {
    id: close.id,
    shop_id: close.shopId,
    period_year: close.periodYear,
    period_month: close.periodMonth,
    status: close.status,
    closed_by: close.closedBy,
    closed_at: close.closedAt,
    notes: close.notes,
    created_at: close.createdAt,
    items,
    has_backdated_movements: backdated,
  };
}

export async function bulkUpdateItems(
  closeId: number,
  updates: { item_id: number; physical_qty: number }[],
): Promise<void> {
  const [close] = await db
    .select({ status: stockPeriodCloses.status })
    .from(stockPeriodCloses)
    .where(eq(stockPeriodCloses.id, closeId))
    .limit(1);
  if (!close) throw err("Close period not found", 404);
  if (close.status === "closed") throw err("Cannot update a closed period", 409);

  for (const u of updates) {
    await db
      .update(stockPeriodCloseItems)
      .set({ physicalQty: u.physical_qty })
      .where(
        and(eq(stockPeriodCloseItems.id, u.item_id), eq(stockPeriodCloseItems.closeId, closeId)),
      );
  }
}

export async function importExcel(
  closeId: number,
  buffer: ArrayBuffer,
): Promise<{ imported: number; skipped: number }> {
  const [close] = await db
    .select({ status: stockPeriodCloses.status })
    .from(stockPeriodCloses)
    .where(eq(stockPeriodCloses.id, closeId))
    .limit(1);
  if (!close) throw err("Close period not found", 404);
  if (close.status === "closed") throw err("Cannot update a closed period", 409);

  const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
  const dataRows = rows.slice(1); // skip header

  let imported = 0;
  let skipped = 0;

  for (const row of dataRows) {
    if (!Array.isArray(row)) { skipped++; continue; }
    const itemId = parseInt(String(row[0] ?? ""), 10);
    const physicalQty = parseInt(String(row[3] ?? ""), 10);

    if (isNaN(itemId) || isNaN(physicalQty) || physicalQty < 0) {
      skipped++;
      continue;
    }

    await db
      .update(stockPeriodCloseItems)
      .set({ physicalQty })
      .where(
        and(eq(stockPeriodCloseItems.id, itemId), eq(stockPeriodCloseItems.closeId, closeId)),
      );
    imported++;
  }

  return { imported, skipped };
}

export async function exportExcel(closeId: number): Promise<Buffer> {
  const items = await fetchItems(closeId);
  const wb = XLSX.utils.book_new();
  const data = [
    ["item_id", "product_name", "system_qty", "physical_qty"],
    ...items.map((i) => [i.id, i.product_name, i.system_qty, i.physical_qty ?? ""]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Stock Count");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export async function confirmClose(closeId: number, userId: number): Promise<CloseDTO> {
  const [close] = await db
    .select()
    .from(stockPeriodCloses)
    .where(eq(stockPeriodCloses.id, closeId))
    .limit(1);
  if (!close) throw err("Close period not found", 404);
  if (close.status === "closed") throw err("Period already confirmed", 409);

  const items = await fetchItems(closeId);
  const unfilled = items.filter((i) => i.physical_qty === null);
  if (unfilled.length > 0) {
    throw err(`${unfilled.length} item(s) still need physical count before confirming`, 422);
  }

  const today = new Date().toISOString().slice(0, 10);
  const monthLabel = `${close.periodYear}-${String(close.periodMonth).padStart(2, "0")}`;

  await pgClient.begin(async (tx) => {
    for (const item of items) {
      const variance = item.physical_qty! - item.system_qty;

      let varianceValue: string | null = null;
      if (item.unit_cost !== null) {
        varianceValue = (variance * parseFloat(item.unit_cost)).toFixed(4);
      }

      if (variance === 0) {
        await tx`
          UPDATE stock_period_close_items
          SET variance_qty = 0, variance_value = 0
          WHERE id = ${item.id}
        `;
        continue;
      }

      const [product] = await tx<{ stock: number; name: string }[]>`
        SELECT stock, name FROM shop_products WHERE id = ${item.product_id} LIMIT 1
      `;
      const stockBefore = product?.stock ?? 0;
      const stockAfter = stockBefore + variance;

      const [movement] = await tx<{ id: number }[]>`
        INSERT INTO shop_movements (date, product_id, product_name, shop_id, type, quantity, stock_before, stock_after, cost_per_unit, note, created_by)
        VALUES (${today}, ${item.product_id}, ${product?.name ?? item.product_name}, ${close.shopId}, 'adjustment', ${variance}, ${stockBefore}, ${stockAfter}, ${item.unit_cost ?? null}, ${"ปิดรอบ " + monthLabel}, ${userId})
        RETURNING id
      `;
      if (!movement) throw new Error("Failed to insert adjustment movement");

      await tx`UPDATE shop_products SET stock = ${stockAfter} WHERE id = ${item.product_id}`;

      await tx`
        UPDATE stock_period_close_items
        SET variance_qty = ${variance}, variance_value = ${varianceValue}, adjustment_movement_id = ${movement.id}
        WHERE id = ${item.id}
      `;
    }

    await tx`
      UPDATE stock_period_closes
      SET status = 'closed', closed_by = ${userId}, closed_at = NOW()
      WHERE id = ${closeId}
    `;
  });

  return getClose(closeId);
}
