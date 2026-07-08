import type { Context, StatusMap } from "elysia";
import ResponseStatus from "@/constants/ResponseStatus";
import { logger, logError } from "@/logger";
import type { RequestContext } from "@/interfaces/ServiceRequest";

type StatusSetter = { status?: number | keyof StatusMap };

/** Matches FastAPI `BusinessRuleError.to_detail()` and frontend `StructuredErrorDetail`. */
export type StructuredErrorDetail = {
	code: string;
	params?: Record<string, unknown>;
	message?: string;
	[key: string]: unknown;
};

/** Thrown by services: `throw Object.assign(new Error("..."), { status, code?, params?, ... })` */
export type ServiceThrownError = Error & {
	status?: number;
	code?: string;
	params?: Record<string, unknown>;
	blocking?: unknown;
	blocking_shops?: unknown;
};

export function successResponse<T>(
    ctx: Context,
    body: T,
    statusCode?: number,
): T;
export function successResponse(
    ctx: Context,
    body?: undefined,
    statusCode?: number,
): undefined;
export function successResponse(
    ctx: Context,
    body?: unknown,
    statusCode: number = ResponseStatus.OK,
) {
    ctx.set.status = statusCode;
    if (body === undefined) return undefined;
    return body;
}

export function errorResponse(
	ctx: Context,
	message: string | StructuredErrorDetail,
	statusCode: number,
	errors?: unknown,
) {
	ctx.set.status = statusCode;
	const body: { detail: string | StructuredErrorDetail; errors?: unknown } = { detail: message };
	if (errors !== undefined) body.errors = errors;
	return body;
}

function toStructuredDetail(err: ServiceThrownError): StructuredErrorDetail {
	const detail: StructuredErrorDetail = {
		code: err.code!,
		message: err.message || err.code!,
	};
	if (err.params && typeof err.params === "object") {
		detail.params = err.params;
	}
	// FastAPI spending-groups delete uses `blocking_shops` inside detail.
	const blocking = err.blocking_shops ?? err.blocking;
	if (blocking !== undefined) {
		detail.blocking_shops = blocking;
	}
	return detail;
}

export function errorFromService(ctx: Context, e: unknown) {
	const reqContext = ctx as RequestContext;
	const err = e as ServiceThrownError;
	const status = err.status;
	const message = err.message ?? (e instanceof Error ? e.message : String(e));

	if (status !== undefined && status >= 400 && status < 600) {
		const detail: string | StructuredErrorDetail = err.code
			? toStructuredDetail({ ...err, message })
			: message || "Bad request";
		logger.warn(`[${reqContext.requestId}] Service error`, {
			status,
			code: err.code,
			message: typeof detail === "string" ? detail : detail.message,
		});
		return errorResponse(ctx, detail, status);
	}

	logError(`[${reqContext.requestId}] Unexpected error from service`, e);
	throw e;
}

export function detailError(set: StatusSetter, message: string, statusCode: number) {
    set.status = statusCode;
    return { detail: message };
}

export function forbidden(set: StatusSetter, message = "Forbidden") {
    return detailError(set, message, ResponseStatus.FORBIDDEN);
}

export function adminOnly(set: StatusSetter) {
    return forbidden(set, "Admin only");
}

export function handleServiceError(set: StatusSetter) {
    return (e: unknown) => {
        const err = e as { status?: number; message?: string };
        if (err.status && err.status >= 400 && err.status < 600) {
            set.status = err.status;
            return { detail: err.message ?? "Bad request" };
        }
        throw e;
    };
}
