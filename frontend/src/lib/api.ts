/**
 * Lightweight API client built on top of `fetch`.
 *
 * Features:
 * - Automatic JSON serialisation / deserialisation
 * - Base URL injection from constants
 * - Auth token header injection (when available)
 * - Consistent error shape via `ApiError`
 */

import i18n from "@/i18n";
import { API_BASE_URL } from "./constants";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

interface StructuredErrorDetail {
  code: string;
  params?: Record<string, unknown>;
  message?: string;
}

function isStructuredErrorDetail(x: unknown): x is StructuredErrorDetail {
  return typeof x === "object" && x !== null && "code" in (x as object);
}

/**
 * Convert backend error detail to a localized string.
 * - If `detail` is a structured error (`{ code, params, message }`), look up
 *   `errors.{code}` in i18n with params interpolation; fall back to `message`
 *   when no translation is registered.
 * - Otherwise treat `detail` as a plain string (backwards-compatible).
 */
function localizeDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (isStructuredErrorDetail(detail)) {
    const { code, params, message } = detail;
    return i18n.t(`errors.${code}`, {
      ...(params ?? {}),
      defaultValue: message ?? code,
    });
  }
  return JSON.stringify(detail);
}

export class ApiError extends Error {
  /** Stable error code from the backend, when the detail was structured. */
  public code?: string;

  constructor(
    public status: number,
    public detail: string,
    public body?: unknown,
    code?: string,
  ) {
    super(detail);
    this.name = "ApiError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Token refresh — single-flight
// ---------------------------------------------------------------------------

// All concurrent 401s share the same in-flight refresh promise so we hit
// /auth/refresh at most once per expiry, then every queued request retries
// with the freshly minted access token.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) return null;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { access_token: string; refresh_token: string };
      localStorage.setItem("access_token", data.access_token);
      if (data.refresh_token) localStorage.setItem("refresh_token", data.refresh_token);
      return data.access_token;
    } catch {
      return null;
    } finally {
      // Release the lock on the next tick so callers awaiting this promise
      // resolve before another refresh can start.
      setTimeout(() => { refreshInFlight = null; }, 0);
    }
  })();

  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Core request helper
// ---------------------------------------------------------------------------

async function request<T>(
  path: string,
  options: RequestInit = {},
  _retried = false,
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  // Inject auth token if present
  const token = localStorage.getItem("access_token");
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    let detail: string = res.statusText;
    let code: string | undefined;
    let body: unknown;
    try {
      body = await res.json();
      const rawDetail = (body as { detail?: unknown }).detail;
      if (isStructuredErrorDetail(rawDetail)) code = rawDetail.code;
      detail = rawDetail !== undefined ? localizeDetail(rawDetail) : JSON.stringify(body);
    } catch {
      /* use statusText fallback */
    }

    // Session expired — clear stored credentials and force re-login.
    //
    // Exception: the customer-display second-monitor window is a public
    // route with no auth. Background calls from shared providers (e.g.
    // SchoolInfoProvider hitting /admin/settings/school) will naturally
    // 401 there, and we must NOT redirect that popup to /login because
    // the resulting navigation cycle (popup → /login → bounce back via
    // router → /customer-display → 401 again) creates an infinite reload
    // loop that burns hundreds of requests and never lets the rotation
    // render. Let the caller catch the 401 and fall back to defaults.
    const isInactiveUser =
      res.status === 403 && (detail === "Inactive user" || detail === "User not found");

    // Attempt token refresh on 401 (once per request) — keeps the user
    // logged in across access-token expiry without bouncing to /login.
    // Skip for the /auth/refresh endpoint itself to avoid infinite loops.
    if (
      res.status === 401 &&
      !_retried &&
      !path.startsWith("/auth/refresh") &&
      window.location.pathname !== "/customer-display"
    ) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        return request<T>(path, options, true);
      }
    }

    if (
      (res.status === 401 || isInactiveUser) &&
      window.location.pathname !== "/customer-display"
    ) {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      localStorage.removeItem("schooney_auth_user");
      window.location.href = "/login";
      throw new ApiError(res.status, detail, body, code);
    }
    if (res.status === 401) {
      // On /customer-display, just surface the error to the caller.
      throw new ApiError(res.status, detail, body, code);
    }

    throw new ApiError(res.status, detail, body, code);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

async function requestRaw<T>(path: string, options: RequestInit, _retried = false): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  const token = localStorage.getItem("access_token");
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    // Match request()'s refresh-and-retry behaviour for multipart uploads.
    if (res.status === 401 && !_retried && !path.startsWith("/auth/refresh")) {
      const newToken = await refreshAccessToken();
      if (newToken) return requestRaw<T>(path, options, true);
    }

    let detail: string = res.statusText;
    let code: string | undefined;
    let body: unknown;
    try {
      body = await res.json();
      const rawDetail = (body as { detail?: unknown }).detail;
      if (isStructuredErrorDetail(rawDetail)) code = rawDetail.code;
      detail = rawDetail !== undefined ? localizeDetail(rawDetail) : JSON.stringify(body);
    } catch { /* fallback */ }
    throw new ApiError(res.status, detail, body, code);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),

  /** Upload multipart/form-data — do NOT set Content-Type, browser adds boundary. */
  postFormData: <T>(path: string, form: FormData) =>
    requestRaw<T>(path, { method: "POST", body: form }),
};
