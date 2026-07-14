/**
 * React Query hooks for the admin cardholder directory (users + customers +
 * departments) and the parent/student family links that hang off it.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Cardholder {
  key: string;
  kind: "student" | "parent" | "staff" | "department" | "other";
  entity_type: "user" | "customer" | "department";
  entity_id: number;
  name: string;
  identifier: string;
  photo_url?: string | null;
  family_code?: string | null;
  external_id?: string | null;
  card_uid?: string | null;
  wallet_id?: number | null;
  wallet_balance?: number | null;
  is_active: boolean;
  is_graduated?: boolean;
  role?: string | null;
  shop_id?: string | null;
  grade?: string | null;
  school_type?: string | null;
  allergies?: string | null;
  department_code?: string | null;
  synced_at?: string | null;
}

export interface FamilyLink {
  id: number;
  parent_user_id: number;
  parent_username?: string | null;
  parent_full_name?: string | null;
  child_customer_id: number;
  child_name?: string | null;
  child_student_code?: string | null;
  relation: string;
}

export interface CardholderListParams {
  kind?: Cardholder["kind"] | "all" | null;
  q?: string | null;
  schoolType?: string | null;
  grade?: string | null;
  shopId?: string | null;
  page?: number;
  pageSize?: number;
  /** Set false to skip firing the request (e.g. a search-driven picker with an empty query). */
  enabled?: boolean;
}

interface CardholderListResponse {
  items: Cardholder[];
  total: number;
  /** Count per kind across the full matching set — NOT just the current page. */
  counts: Record<Cardholder["kind"], number>;
  /** Full student roster KPIs — independent of the active kind/search/page. */
  studentStats: { total: number; withCard: number; noFamilyCode: number };
  /** Distinct grades across the full student roster (for the grade filter). */
  grades: string[];
}

export interface LinkStudentPayload {
  parent_user_id: number;
  child_customer_id: number;
  relation: string;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const cardholderKeys = {
  all: ["cardholders"] as const,
  list: (params: CardholderListParams = {}) => [...cardholderKeys.all, "list", params] as const,
};

export const familyLinkKeys = {
  all: ["familyLinks"] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Cardholder directory — server-side filtered and paginated. Some schools run
 * into the thousands of combined users+customers+departments, so kind/search/
 * page all go to the backend rather than fetching everything and slicing
 * client-side (that approach silently dropped whole kinds off the page once
 * the dataset exceeded the fetch size — see cardholder_service.ts).
 */
export function useCardholders(params: CardholderListParams = {}) {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 50;
  const search = new URLSearchParams();
  if (params.kind && params.kind !== "all") search.set("kind", params.kind);
  if (params.q?.trim()) search.set("q", params.q.trim());
  if (params.schoolType) search.set("school_type", params.schoolType);
  if (params.grade) search.set("grade", params.grade);
  if (params.shopId) search.set("shop_id", params.shopId);
  search.set("page", String(page));
  search.set("page_size", String(pageSize));

  return useQuery({
    queryKey: cardholderKeys.list({ ...params, page, pageSize }),
    queryFn: () => api.get<CardholderListResponse>(`/admin/cardholders?${search.toString()}`),
    enabled: params.enabled ?? true,
    placeholderData: (prev) => prev, // keep showing the old page while the next one loads
  });
}

export function useFamilyLinks() {
  return useQuery({
    queryKey: familyLinkKeys.all,
    queryFn: () => api.get<FamilyLink[]>("/family/links"),
  });
}

/** Delete a cardholder — routes to /users, /customers, or /admin/departments depending on entity_type. */
export function useDeleteCardholder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (c: Cardholder) => {
      const path =
        c.entity_type === "user"
          ? `/users/${c.entity_id}`
          : c.entity_type === "customer"
            ? `/customers/${c.entity_id}`
            : c.entity_type === "department"
              ? `/admin/departments/${c.entity_id}`
              : null;
      if (!path) throw new Error("Unsupported entity type");
      return api.delete(path);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cardholderKeys.all });
    },
  });
}

export function useLinkStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LinkStudentPayload) => api.post("/family/links", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: familyLinkKeys.all });
    },
  });
}

export function useUnlinkFamily() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkId: number) => api.delete(`/family/links/${linkId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: familyLinkKeys.all });
    },
  });
}
