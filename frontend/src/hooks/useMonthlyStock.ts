import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface MonthlyStockRow {
  product_id: number | null;
  product_name: string;
  received: number;
  sold: number;
  internal_use: number;
  adjustment: number;
}

export function useMonthlyStockReport(shopId: string, year: number, month: number) {
  return useQuery({
    queryKey: ["monthly-stock", shopId, year, month],
    queryFn: () =>
      api.get<MonthlyStockRow[]>(
        `/shops/${shopId}/monthly-stock-report?year=${year}&month=${month}`,
      ),
    enabled: !!shopId && !!year && !!month,
  });
}
