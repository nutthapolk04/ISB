/** Shared payment-method display labels — keep in sync with frontend/src/lib/paymentMethodLabels.ts */

export interface PaymentMethodContext {
    edcCardFee?: number | string | null;
    edcMaskedCard?: string | null;
}

export type PaymentMethodLabelKey =
    | "campus_card"
    | "cash"
    | "thai_qr"
    | "edc_qr"
    | "edc_credit_card"
    | "edc_debit_card"
    | "credit_card"
    | "debit_card"
    | "department"
    | "other";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodLabelKey, string> = {
    campus_card: "Campus Card",
    cash: "Cash",
    thai_qr: "Thai QR",
    // EDC only offers card now — the QR sub-mode button is disabled, so this
    // key reads the same as edc_credit_card rather than a QR label nobody can
    // trigger anymore. Keep in sync with frontend/src/lib/paymentMethodLabels.ts.
    edc_qr: "EDC Credit Card",
    edc_credit_card: "EDC Credit Card",
    edc_debit_card: "EDC Debit Card",
    credit_card: "Credit Card",
    debit_card: "Debit Card",
    department: "Budget Deduction",
    other: "Other",
};

export function resolvePaymentMethodLabelKey(
    method: string,
    ctx?: PaymentMethodContext,
): PaymentMethodLabelKey {
    const m = (method ?? "").trim().toLowerCase();
    if (!m) return "other";
    if (m === "wallet" || m === "card_tap") return "campus_card";
    if (m === "cash") return "cash";
    if (["bay_qr", "qr_promptpay", "qr", "bank_transfer"].includes(m)) return "thai_qr";
    if (m === "credit_card" || m === "bay_easypay") return "credit_card";
    if (m === "debit_card") return "debit_card";
    if (m === "department") return "department";
    if (m === "edc") {
        const fee = Number(ctx?.edcCardFee ?? 0);
        const masked = (ctx?.edcMaskedCard ?? "").trim();
        // 3% fee + masked PAN are only recorded for EDC card swipe, never QR.
        if (fee > 0 || masked) return "edc_credit_card";
        return "edc_qr";
    }
    return "other";
}

/** Aggregated sales rows only expose SUM(edc_card_fee) — best-effort EDC split. */
export function resolveAggregatedPaymentMethodLabelKey(
    method: string,
    aggregateEdcCardFee?: number | string | null,
): PaymentMethodLabelKey {
    const m = (method ?? "").trim().toLowerCase();
    if (m === "edc") {
        return Number(aggregateEdcCardFee ?? 0) > 0 ? "edc_credit_card" : "edc_qr";
    }
    return resolvePaymentMethodLabelKey(method);
}

export function formatPaymentMethodLabel(method: string, ctx?: PaymentMethodContext): string {
    const key = resolvePaymentMethodLabelKey(method, ctx);
    return PAYMENT_METHOD_LABELS[key];
}

export function formatAggregatedPaymentMethodLabel(
    method: string,
    aggregateEdcCardFee?: number | string | null,
): string {
    const key = resolveAggregatedPaymentMethodLabelKey(method, aggregateEdcCardFee);
    return PAYMENT_METHOD_LABELS[key];
}
