/**
 * Application-wide constants.
 * Centralised so every module uses the same base URL, currency, etc.
 */

/** Backend API base URL — reads from env or falls back to local dev server. */
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

/** Currency used for formatting (Thai Baht). */
export const CURRENCY = "THB";

/** Locale string used by Intl formatters. */
export const DEFAULT_LOCALE = "th-TH";

/** Default page size for paginated lists. */
export const DEFAULT_PAGE_SIZE = 20;
