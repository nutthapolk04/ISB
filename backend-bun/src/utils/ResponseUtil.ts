import type { Context, StatusMap } from "elysia";
import ResponseStatus from "@/constants/ResponseStatus";
import { logger } from "@/logger";
import { RequestContext } from "@/interfaces/ServiceRequest";

type StatusSetter = { status?: number | keyof StatusMap };

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
    message: string,
    statusCode: number,
    errors?: unknown,
) {
    ctx.set.status = statusCode;
    const body: { detail: string; errors?: unknown } = { detail: message };
    if (errors !== undefined) body.errors = errors;
    return body;
}

export function errorFromService(ctx: Context, e: unknown) {
    const reqContext = ctx as RequestContext;
    const err = e as { status?: number; message?: string };
    if (err.status && err.status >= 400 && err.status < 600) {
        logger.error(`[${reqContext.requestId}] Error from service: ${err.message}`, { status: err.status });
        return errorResponse(ctx, err.message ?? "Bad request", err.status);
    }
    logger.error(`[${reqContext.requestId}] Error from service: ${err.message}`, { status: err.status });
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
