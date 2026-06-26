/** Cardholders — list, create (admin | manager) */
import type { Context } from "elysia";
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import { listCardholders, createCardholder } from "@/services/cardholder_service";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

export const CardholderController = {
	list: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const page = query.page ? Math.max(Number(query.page), 1) : 1;
		const pageSize = query.page_size ? Math.min(Math.max(Number(query.page_size), 1), 500) : 50;
		try {
			return successResponse(
				reqContext,
				await listCardholders({ kind: query.kind ?? null, q: query.q ?? null, page, pageSize }),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await createCardholder(body as Parameters<typeof createCardholder>[0]),
				ResponseStatus.CREATED,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
