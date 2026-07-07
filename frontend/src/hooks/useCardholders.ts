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

interface CardholderListResponse {
  items: Cardholder[];
  total: number;
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
  list: () => [...cardholderKeys.all, "list"] as const,
};

export const familyLinkKeys = {
  all: ["familyLinks"] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Full cardholder directory. Dataset is small (low hundreds) so we fetch it
 * in one page and let callers filter/paginate client-side.
 */
export function useCardholders() {
  return useQuery({
    queryKey: cardholderKeys.list(),
    queryFn: () => api.get<CardholderListResponse>("/admin/cardholders?page_size=500"),
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
