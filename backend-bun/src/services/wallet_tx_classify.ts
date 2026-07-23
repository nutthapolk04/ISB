/**
 * Shared wallet_transactions classification — cash top-ups (kiosk/cashier)
 * and manual admin balance corrections both write transaction_type
 * 'ADJUSTMENT' (see adjustBalance() in wallet_service.ts), distinguished only
 * by the free-text `reason`. Any code that displays a wallet_transactions row
 * must run it through classifyWalletTxKind() rather than trusting the raw
 * transaction_type column, or a kiosk/cashier top-up misreads as a generic
 * "Adjustment".
 */

export type TopupChannel = "kiosk" | "online" | "cashier";

export const CASH_TOPUP_REASON_RE = /^Cash top-up at POS/i;

/** Every kind of wallet-affecting event. `sale` isn't classified here — see
 * report_service.ts's own 'receipt' / 'receipt_void' handling for that. */
export function classifyWalletTxKind(tx: {
    transactionType: string;
    referenceType: string | null;
    reason: string | null;
}): "adjustment" | "topup" | "transfer" | "other" {
    if (tx.referenceType === "family_transfer") return "transfer";
    if (tx.referenceType === "payment_intent") return "topup";
    // adjustBalance() always tags reference_type='admin_adjustment' — this
    // covers both a genuine manual balance correction AND a cash top-up at
    // POS (distinguished only by `reason`). A separate revert/undo path
    // reuses the same reference_type but with TOPUP/DEDUCTION transaction
    // types instead of ADJUSTMENT, so check reference_type first, not type.
    if (tx.referenceType === "admin_adjustment" || tx.transactionType === "ADJUSTMENT") {
        return CASH_TOPUP_REASON_RE.test(tx.reason ?? "") ? "topup" : "adjustment";
    }
    return "other";
}

export function classifyTopupChannel(opts: {
    transactionType: string;
    reason: string | null;
    description: string | null;
    creatorRole: string | null;
}): TopupChannel {
    const text = `${opts.reason ?? ""} ${opts.description ?? ""}`;
    const role = (opts.creatorRole ?? "").toLowerCase();
    if (role === "kiosk" || /kiosk\s*top-?up/i.test(text)) return "kiosk";
    if (role === "parent") return "online";
    if (opts.transactionType === "ADJUSTMENT" && CASH_TOPUP_REASON_RE.test(opts.reason ?? "")) {
        return "cashier";
    }
    if (["cashier", "manager", "admin", "staff", "kitchen"].includes(role)) return "cashier";
    // Gateway TOPUP without a parent role — treat as online (parent portal / card).
    if (opts.transactionType === "TOPUP") return "online";
    return "cashier";
}
