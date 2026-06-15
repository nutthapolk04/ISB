/**
 * React Query hooks for the Refund Family Lookup feature.
 *
 * Used by the Family Lookup section on `/refund` to verify a family before
 * issuing a refund — supports search by famcode / student / parent identifiers
 * and exposes the full family roster (active + graduated + withdrawn).
 */

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types — must match backend/app/schemas/refund_family.py
// ---------------------------------------------------------------------------

export type FamilyEntityType = "user" | "customer";

export interface FamilyMatch {
  family_code: string;
  member_count: number;
  active_count: number;
  graduated_count: number;
  sample_names: string[];
}

export interface FamilySearchResponse {
  query: string;
  items: FamilyMatch[];
}

export interface FamilyMemberDetail {
  entity_type: FamilyEntityType;
  id: number;
  name: string;

  family_code: string | null;
  student_code: string | null;
  customer_code: string | null;
  username: string | null;
  external_id: string | null;

  email: string | null;
  phone: string | null;

  role: string | null;
  customer_type: string | null;
  school_type: string | null;
  grade: string | null;
  photo_url: string | null;

  card_uid: string | null;
  card_frozen: boolean;

  is_active: boolean;
  is_graduated: boolean;
  enroll_date: string | null;
  withdraw_date: string | null;

  wallet_id: number | null;
  wallet_balance: number;
}

export interface FamilyRosterResponse {
  family_code: string;
  members: FamilyMemberDetail[];
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const refundFamilyKeys = {
  all: ["refund-family"] as const,
  search: (q: string) => [...refundFamilyKeys.all, "search", q] as const,
  roster: (code: string) => [...refundFamilyKeys.all, "roster", code] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const MIN_QUERY_LEN = 2;

/**
 * Search for matching families by famcode / student / parent identifiers.
 *
 * The component is responsible for debouncing the input before passing it in.
 * Queries shorter than 2 characters are skipped (matches backend rule).
 */
export function useRefundFamilySearch(q: string, limit = 10) {
  const trimmed = q.trim();
  const enabled = trimmed.length >= MIN_QUERY_LEN;

  return useQuery({
    queryKey: refundFamilyKeys.search(trimmed),
    queryFn: () =>
      api.get<FamilySearchResponse>(
        `/refund/family-search?q=${encodeURIComponent(trimmed)}&limit=${limit}`,
      ),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Fetch the full roster for a single family_code. */
export function useRefundFamilyRoster(familyCode: string | null) {
  return useQuery({
    queryKey: refundFamilyKeys.roster(familyCode ?? ""),
    queryFn: () =>
      api.get<FamilyRosterResponse>(
        `/refund/family/${encodeURIComponent(familyCode as string)}`,
      ),
    enabled: !!familyCode,
    staleTime: 10_000,
  });
}
