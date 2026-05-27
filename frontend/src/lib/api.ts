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
// Core request helper
// ---------------------------------------------------------------------------

async function request<T>(
  path: string,
  options: RequestInit = {},
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

    // Session expired — clear stored credentials and force re-login
    if (res.status === 401) {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      localStorage.removeItem("schooney_auth_user");
      window.location.href = "/login";
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

async function requestRaw<T>(path: string, options: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  const token = localStorage.getItem("access_token");
  if (token) headers.Authorization = `Bearer ${token}`;

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
