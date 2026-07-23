import { CURRENCY, DEFAULT_LOCALE } from "./constants";

/** ฿1,234.56 — Thai Baht, thousands separator, 2 decimal places. */
export function formatCurrency(n: number): string {
  return new Intl.NumberFormat(DEFAULT_LOCALE, { style: "currency", currency: CURRENCY }).format(n);
}

/**
 * Bare number (no currency symbol) for POS tiles/cart lines: "20" for whole
 * baht, "12.5" for a fractional price — never silently rounds a decimal
 * price to a whole number the way `.toFixed(0)` does.
 */
export function formatBahtAmount(n: number): string {
  return new Intl.NumberFormat(DEFAULT_LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
}
