import type { TFunction } from "i18next";

/** Keep resolver logic in sync with backend-bun/src/lib/payment_method_labels.ts */

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

export const PAYMENT_METHOD_LABEL_FALLBACKS: Record<PaymentMethodLabelKey, string> = {
  campus_card: "Campus Card",
  cash: "Cash",
  thai_qr: "Thai QR",
  edc_qr: "EDC QR",
  edc_credit_card: "EDC Credit Card",
  edc_debit_card: "EDC Debit Card",
  credit_card: "Credit Card",
  debit_card: "Debit Card",
  department: "Budget Deduction",
  other: "Other",
};

const PAYMENT_METHOD_LABEL_FALLBACKS_TH: Record<PaymentMethodLabelKey, string> = {
  campus_card: "Campus Card",
  cash: "เงินสด",
  thai_qr: "Thai QR",
  edc_qr: "EDC QR",
  edc_credit_card: "EDC Credit Card",
  edc_debit_card: "EDC Debit Card",
  credit_card: "บัตรเครดิต",
  debit_card: "บัตรเดบิต",
  department: "ตัดงบ",
  other: "อื่นๆ",
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
    if (fee > 0 || masked) return "edc_credit_card";
    return "edc_qr";
  }
  return "other";
}

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

export function formatPaymentMethodLabel(
  t: TFunction,
  method: string,
  ctx?: PaymentMethodContext,
): string {
  const key = resolvePaymentMethodLabelKey(method, ctx);
  return t(`common.paymentMethods.${key}`, PAYMENT_METHOD_LABEL_FALLBACKS[key]);
}

export function formatAggregatedPaymentMethodLabel(
  t: TFunction,
  method: string,
  aggregateEdcCardFee?: number | string | null,
): string {
  const key = resolveAggregatedPaymentMethodLabelKey(method, aggregateEdcCardFee);
  return t(`common.paymentMethods.${key}`, PAYMENT_METHOD_LABEL_FALLBACKS[key]);
}

export function formatPaymentMethodLabelPlain(
  method: string,
  ctx?: PaymentMethodContext,
  locale: "en" | "th" = "en",
): string {
  const key = resolvePaymentMethodLabelKey(method, ctx);
  if (locale === "th") return PAYMENT_METHOD_LABEL_FALLBACKS_TH[key];
  return PAYMENT_METHOD_LABEL_FALLBACKS[key];
}

/** Kiosk transaction report — cash column check. */
export function isCashPaymentMethod(method: string | null | undefined): boolean {
  return resolvePaymentMethodLabelKey(method ?? "") === "cash";
}

/** Kiosk transaction report — QR column check (Thai QR / bay_qr). */
export function isQrPaymentMethod(method: string | null | undefined): boolean {
  return resolvePaymentMethodLabelKey(method ?? "") === "thai_qr";
}

/** Kiosk transaction report — amount in CASH or QR column when method matches. */
export function kioskPaymentAmountValue(
  method: string | null | undefined,
  amount: number,
  type: "cash" | "qr",
): number | null {
  if (type === "cash" && isCashPaymentMethod(method)) return amount;
  if (type === "qr" && isQrPaymentMethod(method)) return amount;
  return null;
}

export function formatAggregatedPaymentMethodLabelPlain(
  method: string,
  aggregateEdcCardFee?: number | string | null,
  locale: "en" | "th" = "en",
): string {
  const key = resolveAggregatedPaymentMethodLabelKey(method, aggregateEdcCardFee);
  if (locale === "th") return PAYMENT_METHOD_LABEL_FALLBACKS_TH[key];
  return PAYMENT_METHOD_LABEL_FALLBACKS[key];
}
