/**
 * Centralized date/time formatting for the entire app.
 *
 * Rules (set by product, do not deviate):
 *   - Display year as Christian Era (ค.ศ.), NEVER Buddhist (พ.ศ.).
 *   - Format dates as DD/MM/YYYY with 4-digit year.
 *   - Format times as HH:mm (24-hour).
 *   - All dates resolve in Asia/Bangkok timezone regardless of browser locale.
 *
 * Use these helpers in every UI surface (filters, tables, reports, dialogs,
 * exports). Do not call `toLocaleDateString` / `toLocaleString` directly for
 * date display — Thai locale silently flips to Buddhist year.
 */

export const APP_TZ = "Asia/Bangkok";

function toDate(v: string | Date | number | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** DD/MM/YYYY in Christian Era, Asia/Bangkok timezone. */
export function fmtDate(v: string | Date | number | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: APP_TZ,
  });
}

/** DD/MM/YYYY HH:mm in Christian Era, Asia/Bangkok timezone, 24-hour clock. */
export function fmtDateTime(v: string | Date | number | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: APP_TZ,
  });
}

/** HH:mm in Asia/Bangkok timezone, 24-hour clock. */
export function fmtTime(v: string | Date | number | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: APP_TZ,
  });
}

/** YYYY-MM-DD in Asia/Bangkok timezone — for API params, filters, query keys. */
export function fmtDateApi(v: string | Date | number | null | undefined): string {
  const d = toDate(v);
  if (!d) return "";
  return d.toLocaleDateString("en-CA", { timeZone: APP_TZ });
}
