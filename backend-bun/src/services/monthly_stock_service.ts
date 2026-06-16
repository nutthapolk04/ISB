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
      sm.product_id,
      sm.product_name,
      SUM(CASE WHEN sm.type = 'receive' THEN sm.quantity ELSE 0 END)::int AS received,
      SUM(CASE WHEN sm.type = 'sale' THEN sm.quantity ELSE 0 END)::int AS sold,
      SUM(CASE WHEN sm.type IN ('internal_use', 'exchange') THEN sm.quantity ELSE 0 END)::int AS internal_use,
      SUM(CASE WHEN sm.type = 'adjustment' THEN (sm.stock_after - sm.stock_before) ELSE 0 END)::int AS adjustment,
      sp.stock AS current_stock
    FROM shop_movements sm
    LEFT JOIN shop_products sp ON sp.id = sm.product_id
    WHERE sm.shop_id = ${shopId}
      AND sm.date >= ${startDate}::date
      AND sm.date <= ${endDate}::date
    GROUP BY sm.product_id, sm.product_name, sp.stock
    ORDER BY sm.product_name
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
