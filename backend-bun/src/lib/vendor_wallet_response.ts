/**
 * POST /api/v1/wallet/adjust-balance response envelope — matches the vendor's
 * documented contract exactly (see "Update ISB" spec, 03/07/2026).
 */
import type { VendorAdjustResultDTO, VendorAdjustError } from "@/services/wallet_service";

export { checkApiKey as checkVendorApiKey } from "@/lib/isb_sync_response";

export type VendorAdjustCode =
  | "SUCCESS"
  | "INSUFFICIENT_BALANCE"
  | "CUSTOMER_NOT_FOUND"
  | "DUPLICATE_TRANSACTION"
  | "INVALID_REQUEST"
  | "SYSTEM_ERROR";

export interface VendorAdjustResponseBody {
  status: "SUCCESS" | "FAILED";
  code: VendorAdjustCode;
  message: string;
  customerId: string;
  transactionId: string;
  amount: number;
  type: "DEDUCT" | "TOPUP";
  source: string;
  balanceBefore: number | null;
  balanceAfter: number | null;
  reasonCode: string | null;
  description: string | null;
  processedAt: string;
}

interface RequestEcho {
  customerId: string;
  transactionId: string;
  amount: number;
  type: "DEDUCT" | "TOPUP";
  source: string;
  reasonCode?: string | null;
  description?: string | null;
}

export function vendorAdjustSuccess(req: RequestEcho, result: VendorAdjustResultDTO): VendorAdjustResponseBody {
  return {
    status: "SUCCESS",
    code: "SUCCESS",
    message: "Transaction completed successfully",
    customerId: req.customerId,
    transactionId: req.transactionId,
    amount: req.amount,
    type: req.type,
    source: req.source,
    balanceBefore: result.balanceBefore,
    balanceAfter: result.balanceAfter,
    reasonCode: req.reasonCode ?? null,
    description: req.description ?? null,
    processedAt: new Date().toISOString(),
  };
}

type VendorSet = { status?: number | string };

export function vendorAdjustFailed(set: VendorSet, req: RequestEcho, err: VendorAdjustError): VendorAdjustResponseBody {
  set.status = err.status;
  return {
    status: "FAILED",
    code: err.code as VendorAdjustCode,
    message: err.message,
    customerId: req.customerId,
    transactionId: req.transactionId,
    amount: req.amount,
    type: req.type,
    source: req.source,
    balanceBefore: err.balanceBefore ?? null,
    balanceAfter: err.balanceAfter ?? null,
    reasonCode: req.reasonCode ?? null,
    description: req.description ?? null,
    processedAt: new Date().toISOString(),
  };
}

export function vendorAdjustSystemError(set: VendorSet, req: RequestEcho, message: string): VendorAdjustResponseBody {
  set.status = 500;
  return {
    status: "FAILED",
    code: "SYSTEM_ERROR",
    message,
    customerId: req.customerId,
    transactionId: req.transactionId,
    amount: req.amount,
    type: req.type,
    source: req.source,
    balanceBefore: null,
    balanceAfter: null,
    reasonCode: req.reasonCode ?? null,
    description: req.description ?? null,
    processedAt: new Date().toISOString(),
  };
}

