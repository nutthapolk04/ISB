import { pgClient } from "@/db/client";
import * as XLSX from "xlsx";

export interface MonthlyStockRow {
  product_id: number | null;
  product_name: string;
  received: number;
  sold: number;
  internal_use: number;
  adjustment: number;
  current_stock: number | null;
}

export async function getMonthlyStockReport(
  shopId: string,
  startDate: string,
  endDate: string,
): Promise<MonthlyStockRow[]> {
  const rows = await pgClient`
    SELECT
      sp.id AS product_id,
      sp.name AS product_name,
      COALESCE(SUM(CASE WHEN sm.type = 'receive' THEN sm.quantity ELSE 0 END), 0)::int AS received,
      COALESCE(SUM(CASE WHEN sm.type = 'sale' THEN sm.quantity ELSE 0 END), 0)::int AS sold,
      COALESCE(SUM(CASE WHEN sm.type IN ('internal_use', 'exchange') THEN sm.quantity ELSE 0 END), 0)::int AS internal_use,
      COALESCE(SUM(CASE WHEN sm.type = 'adjustment' THEN (sm.stock_after - sm.stock_before) ELSE 0 END), 0)::int AS adjustment,
      sp.stock AS current_stock
    FROM shop_products sp
    LEFT JOIN shop_movements sm ON sm.product_id = sp.id
      AND sm.shop_id = ${shopId}
      AND sm.date >= ${startDate}::date
      AND sm.date <= ${endDate}::date
    WHERE sp.shop_id = ${shopId} AND sp.is_active = true
    GROUP BY sp.id, sp.name, sp.stock
    ORDER BY sp.name
  `;
  return rows.map((r: any) => ({
    product_id: r.product_id,
    product_name: r.product_name,
    received: r.received,
    sold: r.sold,
    internal_use: r.internal_use,
    adjustment: r.adjustment,
    current_stock: r.current_stock ?? null,
  }));
}

export async function exportMonthlyStockReport(
  shopId: string,
  startDate: string,
  endDate: string,
): Promise<Buffer> {
  const rows = await getMonthlyStockReport(shopId, startDate, endDate);
  const wb = XLSX.utils.book_new();
  const data = [
    ["Product", "Received", "Sold", "Internal Use", "Adjustment", "Net Change", "Current Stock"],
    ...rows.map((r) => {
      const net = r.received - r.sold - r.internal_use + r.adjustment;
      return [r.product_name, r.received, r.sold, r.internal_use, r.adjustment, net, r.current_stock ?? ""];
    }),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Stock Report");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
