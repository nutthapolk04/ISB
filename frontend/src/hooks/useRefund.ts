/**
 * React Query hooks for the Graduation Refund feature.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RefundMethod = "CASH" | "BANK_TRANSFER" | "CHEQUE";

export interface RefundCandidate {
  id: number;
  name: string;
  student_code: string | null;
  family_code: string | null;
  is_graduated: boolean;
  wallet_id: number;
  wallet_balance: number;
  enroll_date: string | null;
  withdraw_date: string | null;
}

export interface RefundCreateRequest {
  amount: number;
  method: RefundMethod;
  notes?: string;
}

export interface RefundResponse {
  transaction_id: number;
  customer_id: number;
  wallet_id: number;
  amount: number;
  refund_method: RefundMethod;
  balance_before: number;
  balance_after: number;
  reason: "graduation_refund";
  notes: string | null;
  created_at: string;
  created_by_user_id: number;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const refundKeys = {
  all: ["refund"] as const,
  candidates: () => [...refundKeys.all, "candidates"] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** List customers eligible for a graduation refund. */
export function useRefundCandidates() {
  return useQuery({
    queryKey: refundKeys.candidates(),
    queryFn: () => api.get<RefundCandidate[]>("/refund/candidates"),
  });
}

/** Create a graduation refund for the given customer. */
export function useCreateRefund() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      customerId,
      payload,
    }: {
      customerId: number;
      payload: RefundCreateRequest;
    }) => api.post<RefundResponse>(`/refund/${customerId}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: refundKeys.candidates() });
    },
  });
}
