/**
 * FIFO inventory mutations inside an existing postgres-js transaction.
 * Each helper reads existing fifo_lots, applies the change, deletes the old
 * set, inserts the new set, and returns the recomputed (stock, avgCost) so
 * the caller can write them onto shop_products in the same transaction.
 *
 * Mirrors app/services/inventory_service.py FIFO branches.
 */

import {
  calcFifoAvgCost,
  deductFifoLotsInMemory,
  genLotId,
  today,
  type FifoLotIn,
  type FifoLotOut,
} from "@/lib/fifo";

// postgres-js tagged-template signature
type SqlTx = {
  <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

interface LotRow {
  id: string;
  product_id: number;
  shop_id: string;
  date: string;
  qty_remaining: string;
  cost_per_unit: string;
}

function rowToIn(r: LotRow): FifoLotIn {
  return {
    id: r.id,
    productId: r.product_id,
    shopId: r.shop_id,
    date: typeof r.date === "string" ? r.date : new Date(r.date).toISOString().slice(0, 10),
    qtyRemaining: r.qty_remaining,
    costPerUnit: r.cost_per_unit,
  };
}

async function readLots(sqlTx: SqlTx, productId: number): Promise<FifoLotIn[]> {
  const rows = await sqlTx<LotRow[]>`
    SELECT id, product_id, shop_id, date::text AS date, qty_remaining, cost_per_unit
    FROM fifo_lots WHERE product_id = ${productId}
  `;
  return rows.map(rowToIn);
}

async function replaceLots(sqlTx: SqlTx, productId: number, lots: FifoLotOut[]): Promise<void> {
  await sqlTx`DELETE FROM fifo_lots WHERE product_id = ${productId}`;
  for (const l of lots) {
    await sqlTx`
      INSERT INTO fifo_lots (id, product_id, shop_id, date, qty_remaining, cost_per_unit)
      VALUES (${l.id}, ${l.productId}, ${l.shopId}, ${l.date}, ${l.qtyRemaining}, ${l.costPerUnit})
    `;
  }
}

function sumQty(lots: ReadonlyArray<FifoLotIn>): number {
  return lots.reduce((acc, l) => acc + Number(l.qtyRemaining), 0);
}

export interface FifoMutationResult {
  newStock: number;
  newAvgCost: number;
}

/**
 * Sale-path deduction: deduct `qty` (positive) from oldest lots first.
 * Phantom negative lot if exhausted (negative stock allowed).
 */
export async function fifoDeductInTx(
  sqlTx: SqlTx,
  productId: number,
  qty: number,
  shopId: string,
): Promise<FifoMutationResult> {
  const lots = await readLots(sqlTx, productId);
  const next = deductFifoLotsInMemory(lots, qty, productId, shopId);
  await replaceLots(sqlTx, productId, next);
  const newStock = Math.round(next.reduce((a, l) => a + l.qtyRemaining, 0));
  const newAvg = round4(calcFifoAvgCost(next.map((l) => ({
    id: l.id, productId: l.productId, shopId: l.shopId, date: l.date,
    qtyRemaining: l.qtyRemaining, costPerUnit: l.costPerUnit,
  }))));
  return { newStock, newAvgCost: newAvg };
}

/**
 * Refund / return path for FIFO: open a fresh lot at the product's
 * current avg cost (no receipt linkage = best fallback).
 */
export async function fifoRefundLot(
  sqlTx: SqlTx,
  productId: number,
  shopId: string,
  refundQty: number, // positive number
  receiptNumber: string,
  fallbackCost: number,
): Promise<void> {
  await sqlTx`
    INSERT INTO fifo_lots (id, product_id, shop_id, date, qty_remaining, cost_per_unit)
    VALUES (
      ${`refund-${receiptNumber}-${productId}-${Date.now()}`},
      ${productId}, ${shopId}, ${today()}, ${refundQty}, ${fallbackCost}
    )
  `;
}

/**
 * Receive path: append a new lot, recompute avg.
 * Returns new stock (caller's existing stock + qty) and new avg.
 */
export async function fifoReceiveInTx(
  sqlTx: SqlTx,
  productId: number,
  shopId: string,
  stockBefore: number,
  qty: number,
  costPerUnit: number,
): Promise<FifoMutationResult> {
  const lotId = genLotId("recv", productId);
  await sqlTx`
    INSERT INTO fifo_lots (id, product_id, shop_id, date, qty_remaining, cost_per_unit)
    VALUES (${lotId}, ${productId}, ${shopId}, ${today()}, ${qty}, ${costPerUnit})
  `;
  const lots = await readLots(sqlTx, productId);
  return {
    newStock: stockBefore + qty,
    newAvgCost: round4(calcFifoAvgCost(lots)),
  };
}

/**
 * Adjust path: delta!=0. Negative deducts (phantom on exhaust). Positive
 * appends a lot at: input cost → latest lot cost → product.avg_cost fallback.
 */
export async function fifoAdjustInTx(
  sqlTx: SqlTx,
  productId: number,
  shopId: string,
  delta: number,
  fallbackAvgCost: number,
  costPerUnitInput?: number | null,
): Promise<FifoMutationResult> {
  const lots = await readLots(sqlTx, productId);

  if (delta < 0) {
    const next = deductFifoLotsInMemory(lots, Math.abs(delta), productId, shopId);
    await replaceLots(sqlTx, productId, next);
    const newStock = Math.round(next.reduce((a, l) => a + l.qtyRemaining, 0));
    const newAvg = round4(calcFifoAvgCost(next.map((l) => ({
      id: l.id, productId: l.productId, shopId: l.shopId, date: l.date,
      qtyRemaining: l.qtyRemaining, costPerUnit: l.costPerUnit,
    }))));
    return { newStock, newAvgCost: newAvg };
  }

  // delta > 0 → choose cost
  let lotCost: number;
  if (costPerUnitInput !== undefined && costPerUnitInput !== null && costPerUnitInput >= 0) {
    lotCost = costPerUnitInput;
  } else if (lots.length > 0) {
    const latest = [...lots].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    lotCost = Number(latest.costPerUnit);
  } else {
    lotCost = fallbackAvgCost;
  }
  const lotId = genLotId("adj");
  await sqlTx`
    INSERT INTO fifo_lots (id, product_id, shop_id, date, qty_remaining, cost_per_unit)
    VALUES (${lotId}, ${productId}, ${shopId}, ${today()}, ${delta}, ${lotCost})
  `;
  const updated = await readLots(sqlTx, productId);
  const newStock = Math.round(updated.reduce((a, l) => a + Number(l.qtyRemaining), 0));
  return {
    newStock,
    newAvgCost: round4(calcFifoAvgCost(updated)),
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
