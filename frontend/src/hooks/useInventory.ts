/**
 * React Query hooks for inventory and stock management.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { StockLevel, StockAdjustPayload, InventoryTransaction } from "@/types/inventory";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const inventoryKeys = {
  all: ["inventory"] as const,
  stock: () => [...inventoryKeys.all, "stock"] as const,
  stockList: (filters: Record<string, string>) =>
    [...inventoryKeys.stock(), filters] as const,
  transactions: () => [...inventoryKeys.all, "transactions"] as const,
  transactionList: (filters: Record<string, string>) =>
    [...inventoryKeys.transactions(), filters] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Get stock levels with optional low-stock filter. */
export function useStockLevels(filters: { low_stock?: boolean; search?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.low_stock) params.set("low_stock", "true");
  if (filters.search) params.set("q", filters.search);

  return useQuery({
    queryKey: inventoryKeys.stockList(Object.fromEntries(params)),
    queryFn: () => api.get<StockLevel[]>(`/inventory?${params.toString()}`),
  });
}

/** Get inventory transactions history. */
export function useInventoryTransactions(
  filters: { variant_id?: number; page?: number } = {},
) {
  const params = new URLSearchParams();
  if (filters.variant_id) params.set("variant_id", String(filters.variant_id));
  if (filters.page) params.set("page", String(filters.page));

  return useQuery({
    queryKey: inventoryKeys.transactionList(Object.fromEntries(params)),
    queryFn: () =>
      api.get<InventoryTransaction[]>(`/inventory/transactions?${params.toString()}`),
  });
}

/** Adjust stock (manual increase/decrease with reason). */
export function useStockAdjust() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: StockAdjustPayload) =>
      api.post<StockLevel>("/inventory/adjust", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}
