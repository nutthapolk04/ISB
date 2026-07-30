/** Top-up / kiosk transaction reports — ISB ID in its own column. */

export interface TopupPartyRow {
  topped_by: string;
  topped_by_external_id?: string | null;
  recipient_name: string;
  recipient_external_id?: string | null;
  recipient_code?: string | null;
}

export interface KioskTxnPartyRow {
  topped_by?: string | null;
  topped_by_external_id?: string | null;
  topped_up_to?: string | null;
  topped_up_to_external_id?: string | null;
}

export function displayIsbId(externalId?: string | null): string {
  const id = externalId?.trim();
  return id || "—";
}

export function displayTopupRecipientExternalId(
  row: Pick<TopupPartyRow, "recipient_external_id" | "recipient_code">,
): string {
  return displayIsbId(row.recipient_external_id ?? row.recipient_code);
}

export const KIOSK_TXN_PAYMENT_LABELS: Record<string, string> = {
  bay_qr: "QR",
  qr_promptpay: "QR",
  qr: "QR",
  cash: "Cash",
  CASH: "Cash",
  wallet: "Wallet",
  card_tap: "Member Card",
};

export function formatKioskTxnPaymentMethod(method: string): string {
  const key = method.trim();
  if (!key) return "—";
  return KIOSK_TXN_PAYMENT_LABELS[key] ?? KIOSK_TXN_PAYMENT_LABELS[key.toLowerCase()] ?? method;
}
