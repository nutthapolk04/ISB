/** Cardholders — list, create (admin | manager) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import { logger } from "@/logger";
import { listCardholders, createCardholder } from "@/services/cardholder_service";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

export const CardholderController = {
	list: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (CH-01)] CardholderController.list() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (CH-01)] CardholderController.list() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const page = query.page ? Math.max(Number(query.page), 1) : 1;
		const pageSize = query.page_size ? Math.min(Math.max(Number(query.page_size), 1), 500) : 50;
		try {
			logger.info(`[${reqContext.requestId} (CH-01)] CardholderController.list() calling listCardholders().`);
			const result = await listCardholders({ kind: query.kind ?? null, q: query.q ?? null, page, pageSize });
			logger.info(`[${reqContext.requestId} (CH-01)] CardholderController.list() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CH-01)] CardholderController.list() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (CH-02)] CardholderController.create() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (CH-02)] CardholderController.create() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (CH-02)] CardholderController.create() calling createCardholder().`);
			const result = await createCardholder(body as Parameters<typeof createCardholder>[0]);
			logger.info(`[${reqContext.requestId} (CH-02)] CardholderController.create() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CH-02)] CardholderController.create() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
