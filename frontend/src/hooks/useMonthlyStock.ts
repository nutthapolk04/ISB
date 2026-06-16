import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface MonthlyStockRow {
  product_id: number | null;
  product_name: string;
  received: number;
  sold: number;
  internal_use: number;
  adjustment: number;
  current_stock: number | null;
}

export function useMonthlyStockReport(shopId: string, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ["monthly-stock", shopId, startDate, endDate],
    queryFn: () =>
      api.get<MonthlyStockRow[]>(
        `/shops/${shopId}/monthly-stock-report?start_date=${startDate}&end_date=${endDate}`,
      ),
    enabled: !!shopId && !!startDate && !!endDate,
  });
}
