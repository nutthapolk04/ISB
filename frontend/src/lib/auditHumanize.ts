// Translate raw audit_logs rows into human-readable summaries + key/value tables.
// Backend stores entity_type / action as machine codes and `changes` as a free
// JSON blob. The helpers below map those to localized labels so non-technical
// admins (school staff) can scan the log without decoding field names.

import type { TFunction } from "i18next";

export interface AuditChangeRow {
  label: string;
  value: string;
  emphasis?: "added" | "removed" | "changed";
}

const fmtMoney = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const isNumeric = (v: unknown): v is number =>
  typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v)));

const toNumber = (v: unknown): number =>
  typeof v === "number" ? v : Number(v);

// Fields whose values should render as currency (฿xxx.xx).
const MONEY_FIELDS = new Set([
  "total", "amount", "balance", "old_balance", "new_balance",
  "price", "old_price", "new_price", "cost", "refund_amount",
  "exchange_amount", "subtotal", "discount",
]);

export function entityLabel(t: TFunction, type: string): string {
  return t(`audit.entity.${type}`, { defaultValue: type });
}

export function actionLabel(t: TFunction, action: string): string {
  return t(`audit.actionLabel.${action}`, { defaultValue: action });
}

export function fieldLabel(t: TFunction, key: string): string {
  return t(`audit.field.${key}`, { defaultValue: key });
}

function paymentLabel(t: TFunction, code: string): string {
  return t(`audit.payment.${code}`, { defaultValue: code });
}

function formatValue(t: TFunction, key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return t("audit.labelEmpty");
  }
  if (typeof value === "boolean") {
    return t(value ? "audit.labelTrue" : "audit.labelFalse");
  }
  if (key === "payment_method" && typeof value === "string") {
    return paymentLabel(t, value);
  }
  if (MONEY_FIELDS.has(key) && isNumeric(value)) {
    return `฿${fmtMoney(toNumber(value))}`;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Build a one-line narrative summary for a row. Falls back to a generic
 * "ACTION → entity" string when we don't have a specific template.
 */
export function humanizeSummary(
  t: TFunction,
  entityType: string,
  action: string,
  changes: unknown,
): string {
  const c = (changes && typeof changes === "object" ? changes : {}) as Record<string, unknown>;

  // ── Receipts ───────────────────────────────────────────────────────────
  if (entityType === "receipt" && action === "CREATE") {
    const items = c.items ?? c.item_count ?? "?";
    const total = isNumeric(c.total) ? fmtMoney(toNumber(c.total)) : "?";
    if (typeof c.payment_method === "string") {
      return t("audit.summary.createReceipt", {
        items,
        total,
        payment: paymentLabel(t, c.payment_method),
      });
    }
    return t("audit.summary.createReceiptNoPayment", { items, total });
  }
  if (entityType === "receipt" && action === "VOID") {
    const total = isNumeric(c.total) ? fmtMoney(toNumber(c.total)) : "0.00";
    return t("audit.summary.voidReceipt", { total });
  }

  // ── Product price update ───────────────────────────────────────────────
  if (action === "UPDATE_PRICE") {
    const from = isNumeric(c.old_price) ? fmtMoney(toNumber(c.old_price))
      : isNumeric(c.from) ? fmtMoney(toNumber(c.from)) : "?";
    const to = isNumeric(c.new_price) ? fmtMoney(toNumber(c.new_price))
      : isNumeric(c.to) ? fmtMoney(toNumber(c.to)) : "?";
    return t("audit.summary.updatePrice", { from, to });
  }

  // ── Wallet balance adjust ──────────────────────────────────────────────
  if (action === "UPDATE_BALANCE") {
    const from = isNumeric(c.old_balance) ? fmtMoney(toNumber(c.old_balance))
      : isNumeric(c.from) ? fmtMoney(toNumber(c.from)) : "?";
    const to = isNumeric(c.new_balance) ? fmtMoney(toNumber(c.new_balance))
      : isNumeric(c.to) ? fmtMoney(toNumber(c.to)) : "?";
    return t("audit.summary.updateBalance", { from, to });
  }

  // ── System setting ─────────────────────────────────────────────────────
  if (action === "UPDATE_SETTING") {
    const fields = Object.keys(c).map((k) => fieldLabel(t, k)).join(", ");
    return t("audit.summary.updateSetting", { fields: fields || "—" });
  }

  // ── Product delete ─────────────────────────────────────────────────────
  if (action === "DELETE_PRODUCT") {
    return t("audit.summary.deleteProduct");
  }

  // ── Generic create / fallback ──────────────────────────────────────────
  if (action === "CREATE") {
    return t("audit.summary.createGeneric", { entity: entityLabel(t, entityType) });
  }

  return t("audit.summary.fallback", {
    action: actionLabel(t, action),
    entity: entityLabel(t, entityType),
  });
}

/**
 * Transform the raw `changes` JSON into a translated table the user can scan.
 * Returns [] when there are no entries so callers can collapse the section.
 */
export function humanizeChanges(t: TFunction, changes: unknown): AuditChangeRow[] {
  if (!changes || typeof changes !== "object") return [];
  return Object.entries(changes as Record<string, unknown>).map(([key, value]) => ({
    label: fieldLabel(t, key),
    value: formatValue(t, key, value),
  }));
}
