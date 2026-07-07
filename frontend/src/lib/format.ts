import { CURRENCY, DEFAULT_LOCALE } from "./constants";

/** ฿1,234.56 — Thai Baht, thousands separator, 2 decimal places. */
export function formatCurrency(n: number): string {
  return new Intl.NumberFormat(DEFAULT_LOCALE, { style: "currency", currency: CURRENCY }).format(n);
}
