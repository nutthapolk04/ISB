/**
 * FIFO inventory helpers — mirror app/services/inventory_service.py
 * (calc_new_avg_cost, calc_fifo_avg_cost, _deduct_fifo_lots_in_memory).
 *
 * Pure functions, no DB. Caller is responsible for reading lots, deleting
 * old rows, and inserting the updated set inside its own transaction.
 */

export interface FifoLotIn {
  id: string;
  productId: number;
  shopId: string;
  date: string; // YYYY-MM-DD
  qtyRemaining: string | number; // numeric(10,4) from postgres-js arrives as string
  costPerUnit: string | number;
}

export interface FifoLotOut {
  id: string;
  productId: number;
  shopId: string;
  date: string;
  qtyRemaining: number;
  costPerUnit: number;
}

function num(v: string | number): number {
  return typeof v === "string" ? Number(v) : v;
}

/** Weighted average cost recompute for avg_cost shops + receive path. */
export function calcNewAvgCost(
  currentStock: number,
  currentAvgCost: number,
  newQty: number,
  newCostPerUnit: number,
): number {
  const safeStock = Math.max(currentStock, 0);
  const totalValue = safeStock * currentAvgCost;
  const totalQty = safeStock + newQty;
  if (totalQty === 0) return newCostPerUnit;
  return (totalValue + newQty * newCostPerUnit) / totalQty;
}

/** Display avg cost = weighted average across remaining lots. */
export function calcFifoAvgCost(lots: ReadonlyArray<FifoLotIn>): number {
  const totalQty = lots.reduce((acc, l) => acc + num(l.qtyRemaining), 0);
  if (totalQty === 0) return 0;
  const totalValue = lots.reduce((acc, l) => acc + num(l.qtyRemaining) * num(l.costPerUnit), 0);
  return totalValue / totalQty;
}

/**
 * Deduct `qty` (positive) from oldest lots first.
 * Returns the new lot state — caller deletes existing lots and inserts these.
 * If lots are exhausted, appends a phantom lot with negative qty_remaining at
 * the latest lot's cost (or 0 if no lots existed).
 */
export function deductFifoLotsInMemory(
  lots: ReadonlyArray<FifoLotIn>,
  qty: number,
  productId: number,
  shopId: string,
): FifoLotOut[] {
  const sorted = [...lots].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let remaining = Math.abs(qty);
  const out: FifoLotOut[] = [];

  for (const lot of sorted) {
    if (remaining <= 0) {
      out.push({
        id: lot.id,
        productId: lot.productId,
        shopId: lot.shopId,
        date: lot.date,
        qtyRemaining: num(lot.qtyRemaining),
        costPerUnit: num(lot.costPerUnit),
      });
      continue;
    }
    const lotQty = num(lot.qtyRemaining);
    const deduct = Math.min(lotQty, remaining);
    remaining -= deduct;
    const newQty = lotQty - deduct;
    if (newQty > 0) {
      out.push({
        id: lot.id,
        productId: lot.productId,
        shopId: lot.shopId,
        date: lot.date,
        qtyRemaining: newQty,
        costPerUnit: num(lot.costPerUnit),
      });
    }
  }

  if (remaining > 0) {
    const latest = sorted[sorted.length - 1];
    const fallbackCost = latest ? num(latest.costPerUnit) : 0;
    out.push({
      id: `phantom-${Date.now()}`,
      productId,
      shopId,
      date: new Date().toISOString().slice(0, 10),
      qtyRemaining: -remaining,
      costPerUnit: fallbackCost,
    });
  }

  return out;
}

/** Today as YYYY-MM-DD (server local — matches FastAPI date.today()). */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Unique id for a freshly created lot. */
export function genLotId(prefix: string, productId?: number): string {
  const ts = Date.now();
  return productId !== undefined ? `${prefix}-${ts}-${productId}` : `${prefix}-${ts}`;
}
