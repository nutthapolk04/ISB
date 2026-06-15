/**
 * React Query hooks for receipt-related API calls.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Receipt, CheckoutPayload } from "@/types/receipt";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const receiptKeys = {
  all: ["receipts"] as const,
  lists: () => [...receiptKeys.all, "list"] as const,
  list: (filters: Record<string, string>) =>
    [...receiptKeys.lists(), filters] as const,
  detail: (id: number) => [...receiptKeys.all, "detail", id] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Paginated receipt list with optional search. */
export function useReceipts(filters: { search?: string; page?: number } = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.page) params.set("page", String(filters.page));

  return useQuery({
    queryKey: receiptKeys.list(Object.fromEntries(params)),
    queryFn: () => api.get<Receipt[]>(`/pos/receipt?${params.toString()}`),
  });
}

/** Single receipt by ID. */
export function useReceipt(id: number) {
  return useQuery({
    queryKey: receiptKeys.detail(id),
    queryFn: () => api.get<Receipt>(`/pos/receipt/${id}`),
    enabled: id > 0,
  });
}

/** POS checkout mutation — creates a receipt and deducts stock. */
export function useCheckout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CheckoutPayload) =>
      api.post<Receipt>("/pos/checkout", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: receiptKeys.all });
      // Also invalidate product stock data
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
  });
}

/** Void a receipt. */
export function useVoidReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (receiptId: number) =>
      // Send an explicit JSON body so Bun/Elysia doesn't try to bind an
      // undefined body. Reason is null when the UI doesn't collect one.
      api.post<Receipt>(`/pos/void/${receiptId}`, { reason: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: receiptKeys.all });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
  });
}
