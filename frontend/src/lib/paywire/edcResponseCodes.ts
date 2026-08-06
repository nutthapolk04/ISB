/**
 * What a terminal response code actually means for the cashier.
 *
 * Extracted from EdcPaymentModal so the mapping is unit-testable on its own:
 * getting this wrong is a money bug in both directions — treating a charge as a
 * decline invites a double charge, and treating a decline as a charge hands out
 * goods for free.
 *
 * Every entry below is sourced from `docs/edc/sdk-js/GUIDELINE.md` §5 (the
 * bridge vendor's own tables for LinkPOS/Newland and VTI/Verifone).
 */

/**
 * Codes that mean the customer's money is committed, so the POS must record a
 * sale and must never offer a naive "Try again".
 *
 *   00      — approved by the issuer (both protocols).
 *   Y1 / Y3 — VTI **offline approved**. The terminal authorised locally without
 *             reaching the host and printed its slip; GUIDELINE §5 says
 *             "Settlement will clear it". This is a real charge even though the
 *             code is not "00".
 *   DR      — LinkPOS duplicate POS reference. §5: "The prior result already
 *             applies — treat as success". §6 adds that this is what you get
 *             when a request is retried with the same idempotency key, i.e. the
 *             original transaction went through.
 *   DI      — VTI duplicate invoice. §5: "Return prior result as success".
 *
 * Z1/Z3 (offline *declined*) are deliberately absent — those are declines.
 */
const APPROVED_RESPONSE_CODES = new Set(["00", "Y1", "Y3", "DR", "DI"]);

/**
 * Cancelled at the terminal by the customer or cashier — not a bank decline, so
 * the UI bounces back to the payment-method choice rather than showing a
 * decline card. VTI: UC/CN/XC. LinkPOS: UC.
 */
const CANCELLED_RESPONSE_CODES = new Set(["UC", "CN", "XC"]);

export type EdcOutcome = "approved" | "cancelled" | "declined";

/**
 * Classify a terminal response code.
 *
 * Anything unrecognised falls through to "declined", which is the safe default:
 * a decline shows an error and takes no money-affecting action, whereas
 * wrongly reporting success would create a receipt and deduct stock for a sale
 * that never happened.
 */
export function classifyEdcResponse(responseCode: string | null | undefined): EdcOutcome {
    const code = String(responseCode ?? "").trim().toUpperCase();
    if (APPROVED_RESPONSE_CODES.has(code)) return "approved";
    if (CANCELLED_RESPONSE_CODES.has(code)) return "cancelled";
    return "declined";
}

/**
 * True when the terminal took the money but the code is not a plain "00".
 * Used only for wording — these still follow the approved path, but the cashier
 * is told the sale settled unusually so a mismatch on the slip is expected.
 */
export function isNonStandardApproval(responseCode: string | null | undefined): boolean {
    const code = String(responseCode ?? "").trim().toUpperCase();
    return code !== "00" && APPROVED_RESPONSE_CODES.has(code);
}
