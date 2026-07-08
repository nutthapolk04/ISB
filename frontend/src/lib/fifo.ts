export interface FifoLot {
  id: string;
  productId: number;
  date: string;
  qtyRemaining: number;
  costPerUnit: number;
}

export function calcNewAvgCost(
  currentStock: number,
  currentAvgCost: number,
  newQty: number,
  newCostPerUnit: number,
): number {
  const totalCurrentValue = Math.max(currentStock, 0) * currentAvgCost;
  const totalQty = Math.max(currentStock, 0) + newQty;
  if (totalQty === 0) return newCostPerUnit;
  return (totalCurrentValue + newQty * newCostPerUnit) / totalQty;
}

export function calcFifoAvgCost(lots: FifoLot[]): number {
  const totalQty = lots.reduce((s, l) => s + l.qtyRemaining, 0);
  if (totalQty === 0) return 0;
  return lots.reduce((s, l) => s + l.qtyRemaining * l.costPerUnit, 0) / totalQty;
}

/** Deduct qty from oldest lots first; removes fully-depleted lots.
 *  If all lots are exhausted and qty still remains (negative stock scenario),
 *  appends a phantom lot with negative qtyRemaining using the latest lot's
 *  costPerUnit as COGS fallback. */
export function deductFifoLots(lots: FifoLot[], qty: number): FifoLot[] {
  const sorted = [...lots].sort((a, b) => a.date.localeCompare(b.date));
  let remaining = Math.abs(qty);
  const result = sorted
    .map((lot) => {
      if (remaining <= 0) return lot;
      const deduct = Math.min(lot.qtyRemaining, remaining);
      remaining -= deduct;
      return { ...lot, qtyRemaining: lot.qtyRemaining - deduct };
    })
    .filter((lot) => lot.qtyRemaining > 0);

  // Phantom lot: when stock goes negative, record the overshoot with latest lot's cost
  if (remaining > 0) {
    const latestLot = sorted[sorted.length - 1];
    result.push({
      id: `phantom-${Date.now()}`,
      productId: latestLot?.productId ?? 0,
      date: new Date().toISOString().slice(0, 10),
      qtyRemaining: -remaining,
      costPerUnit: latestLot?.costPerUnit ?? 0,
    });
  }

  return result;
}
