/**
 * ISB → Vendor Sync API response envelopes (OpenAPI v1.0.0).
 */

export interface SyncSuccessBody {
  status: "SUCCESS";
  code: "200";
  message: "Accepted";
}

export interface SyncErrorBody {
  status: "FAILED";
  code: string;
  message: string;
  errors?: Array<Record<string, unknown>> | null;
}

export interface BatchProcessingError {
  index: number;
  id: string | number;
  error: string;
}

export function syncSuccess(): SyncSuccessBody {
  return { status: "SUCCESS", code: "200", message: "Accepted" };
}

type SyncSet = { status?: number | string };

export function syncAuthFailed(set: SyncSet): SyncErrorBody {
  set.status = 401;
  return {
    status: "FAILED",
    code: "401",
    message: "Invalid or missing API key (expected header 'x-api-key').",
  };
}

const VALIDATION_MESSAGE = "Request body does not match the ISB->Vendor contract.";

export function syncValidationFailed(
  set: SyncSet,
  errors: Array<Record<string, unknown>>,
): SyncErrorBody {
  set.status = 422;
  return {
    status: "FAILED",
    code: "422",
    message: VALIDATION_MESSAGE,
    errors,
  };
}

export function syncProcessingFailed(
  set: SyncSet,
  batchErrors: BatchProcessingError[],
): SyncErrorBody {
  set.status = 500;
  return {
    status: "FAILED",
    code: "500",
    message: "One or more records failed to upsert.",
    errors: batchErrors.map((e) => ({
      index: e.index,
      id: e.id,
      msg: e.error,
    })),
  };
}

/** Map Elysia / TypeBox validation error message to ISB ErrorResponse.errors entries. */
export function mapValidationError(error: Error): Array<Record<string, unknown>> {
  const raw = error.message;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => normalizeValidationItem(item));
    }
  } catch {
    // fall through
  }
  return [{ type: "validation", loc: ["body"], msg: raw }];
}

function normalizeValidationItem(item: unknown): Record<string, unknown> {
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    const loc = Array.isArray(o.path)
      ? ["body", ...o.path.map(String)]
      : Array.isArray(o.loc)
        ? o.loc
        : ["body"];
    return {
      type: typeof o.type === "string" ? o.type : "validation",
      loc,
      msg: typeof o.message === "string" ? o.message : typeof o.msg === "string" ? o.msg : "Validation failed",
    };
  }
  return { type: "validation", loc: ["body"], msg: String(item) };
}

export function checkApiKey(
  headers: Record<string, string | undefined>,
): boolean {
  const apiKey = process.env.ISB_SYNC_API_KEY;
  if (!apiKey) return false;
  const provided = headers["x-api-key"] ?? headers["X-Api-Key"] ?? headers["X-API-Key"];
  return provided === apiKey;
}
