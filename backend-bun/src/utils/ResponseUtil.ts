import type { Context, StatusMap } from "elysia";
import ResponseStatus from "@/constants/ResponseStatus";

type StatusSetter = { status?: number | keyof StatusMap };

export function successResponse(
	ctx: Context,
	body?: unknown,
	statusCode: number = ResponseStatus.OK,
) {
	ctx.set.status = statusCode;
	if (body === undefined) return;
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
