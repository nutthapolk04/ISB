import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface CloseItem {
  id: number;
  product_id: number;
  product_name: string;
  system_qty: number;
  physical_qty: number | null;
  variance_qty: number | null;
  unit_cost: string | null;
  variance_value: string | null;
  adjustment_movement_id: number | null;
}

export interface CloseDetail {
  id: number;
  shop_id: string;
  period_year: number;
  period_month: number;
  status: string;
  closed_by: number | null;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
  items: CloseItem[];
  has_backdated_movements: boolean;
}

export interface CloseSummary {
  id: number;
  shop_id: string;
  period_year: number;
  period_month: number;
  status: string;
  closed_by: number | null;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
}

const closeMonthKeys = {
  all: (shopId: string) => ["close-month", shopId] as const,
  list: (shopId: string) => [...closeMonthKeys.all(shopId), "list"] as const,
  detail: (shopId: string, closeId: number) => [...closeMonthKeys.all(shopId), "detail", closeId] as const,
};

export function useCloseList(shopId: string) {
  return useQuery({
    queryKey: closeMonthKeys.list(shopId),
    queryFn: () => api.get<CloseSummary[]>(`/shops/${shopId}/close-month`),
    enabled: !!shopId,
  });
}

export function useCloseDetail(shopId: string, closeId: number) {
  return useQuery({
    queryKey: closeMonthKeys.detail(shopId, closeId),
    queryFn: () => api.get<CloseDetail>(`/shops/${shopId}/close-month/${closeId}`),
    enabled: !!shopId && !!closeId,
  });
}

export function useCreateClose(shopId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { period_year: number; period_month: number }) =>
      api.post<CloseDetail>(`/shops/${shopId}/close-month`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: closeMonthKeys.list(shopId) }),
  });
}

export function useBulkUpdateItems(shopId: string, closeId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: { item_id: number; physical_qty: number }[]) =>
      api.patch<{ ok: boolean }>(`/shops/${shopId}/close-month/${closeId}/items`, { updates }),
    onSuccess: () => qc.invalidateQueries({ queryKey: closeMonthKeys.detail(shopId, closeId) }),
  });
}

export function useImportCsv(shopId: string, closeId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.postFormData<{ imported: number; skipped: number }>(
        `/shops/${shopId}/close-month/${closeId}/import-csv`,
        form,
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: closeMonthKeys.detail(shopId, closeId) }),
  });
}

export function useConfirmClose(shopId: string, closeId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<CloseDetail>(`/shops/${shopId}/close-month/${closeId}/confirm`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: closeMonthKeys.all(shopId) });
    },
  });
}
