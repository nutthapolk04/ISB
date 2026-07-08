import { SECTION_KEY, EMPHASIS_KEY } from "@/lib/reportExport";

export interface CanteenShop { id: string; name: string; }

/**
 * Group rows by vendor for admin / multi-shop views. Returns the input rows
 * unchanged when only one shop appears (vendor user, or admin filtered to a
 * single shop) — the caller is then expected to surface the vendor name via
 * a "Shop: …" filter line instead. When multiple shops appear, inserts a
 * SECTION_KEY header row before each shop's rows and an EMPHASIS_KEY
 * "subtotal" row after, using `buildSubtotal` to fill the numeric columns.
 */
export function buildVendorSections<T extends { shop_id: string; shop_name: string | null }>(
  rows: T[],
  buildSubtotal: (shopRows: T[]) => Record<string, unknown>,
): Record<string, unknown>[] {
  const uniqueShops = new Set(rows.map((r) => r.shop_id));
  if (uniqueShops.size <= 1) {
    return rows as unknown as Record<string, unknown>[];
  }

  const byShop = new Map<string, { name: string | null; rows: T[] }>();
  for (const r of rows) {
    const entry = byShop.get(r.shop_id);
    if (entry) entry.rows.push(r);
    else byShop.set(r.shop_id, { name: r.shop_name, rows: [r] });
  }

  const out: Record<string, unknown>[] = [];
  for (const [shopId, { name, rows: shopRows }] of byShop) {
    out.push({ [SECTION_KEY]: `Vendor: ${name ?? shopId}` });
    for (const r of shopRows) out.push(r as unknown as Record<string, unknown>);
    out.push({ [EMPHASIS_KEY]: "subtotal" as const, ...buildSubtotal(shopRows) });
  }
  return out;
}

/** True when the result spans more than one shop (admin / canteen-area-mgr "all"). */
export function isMultiVendor<T extends { shop_id: string }>(rows: T[]): boolean {
  if (rows.length < 2) return false;
  const first = rows[0].shop_id;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].shop_id !== first) return true;
  }
  return false;
}
