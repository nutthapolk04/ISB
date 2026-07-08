/** Canteen ops — POST /canteen/:shopId/close-day (admin | manager | cashier) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import { logger } from "@/logger";
import { closeDay } from "@/services/canteen_service";
import { scopeShop } from "@/services/report_service";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

export const CanteenController = {
	closeDay: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (CN-01)] CanteenController.closeDay() called.`);
		if (!hasRole(user.roles, "admin", "manager", "cashier")) {
			logger.warn(`[${reqContext.requestId} (CN-01)] CanteenController.closeDay() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const effective = scopeShop(user, params.shopId);
		if (!effective) {
			logger.warn(`[${reqContext.requestId} (CN-01)] CanteenController.closeDay() not authorized for shop.`);
			return errorResponse(reqContext, "Not authorized for that shop", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (CN-01)] CanteenController.closeDay() calling closeDay().`);
			const result = await closeDay(effective);
			logger.info(`[${reqContext.requestId} (CN-01)] CanteenController.closeDay() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CN-01)] CanteenController.closeDay() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
