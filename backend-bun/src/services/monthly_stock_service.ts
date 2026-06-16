import { pgClient } from "@/db/client";
import * as XLSX from "xlsx";

export interface MonthlyStockRow {
  product_id: number | null;
  product_name: string;
  received: number;
  sold: number;
  internal_use: number;
  adjustment: number;
}

export async function getMonthlyStockReport(
  shopId: string,
  year: number,
  month: number,
): Promise<MonthlyStockRow[]> {
  const rows = await pgClient`
    SELECT
      sm.product_id,
      sm.product_name,
      SUM(CASE WHEN sm.type = 'receive' THEN sm.quantity ELSE 0 END)::int AS received,
      SUM(CASE WHEN sm.type = 'sale' THEN sm.quantity ELSE 0 END)::int AS sold,
      SUM(CASE WHEN sm.type IN ('internal_use', 'exchange') THEN sm.quantity ELSE 0 END)::int AS internal_use,
      SUM(CASE WHEN sm.type = 'adjustment' THEN (sm.stock_after - sm.stock_before) ELSE 0 END)::int AS adjustment
    FROM shop_movements sm
    WHERE sm.shop_id = ${shopId}
      AND EXTRACT(YEAR FROM sm.date) = ${year}
      AND EXTRACT(MONTH FROM sm.date) = ${month}
    GROUP BY sm.product_id, sm.product_name
    ORDER BY sm.product_name
  `;
  return rows.map((r: any) => ({
    product_id: r.product_id,
    product_name: r.product_name,
    received: r.received,
    sold: r.sold,
    internal_use: r.internal_use,
    adjustment: r.adjustment,
  }));
}

export async function exportMonthlyStockReport(
  shopId: string,
  year: number,
  month: number,
): Promise<Buffer> {
  const rows = await getMonthlyStockReport(shopId, year, month);
  const wb = XLSX.utils.book_new();
  const data = [
    ["Product", "Received", "Sold", "Internal Use", "Adjustment", "Net Change"],
    ...rows.map((r) => {
      const net = r.received - r.sold - r.internal_use + r.adjustment;
      return [r.product_name, r.received, r.sold, r.internal_use, r.adjustment, net];
    }),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Monthly Stock");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
