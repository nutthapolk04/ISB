/** Canteen ops — POST /canteen/:shopId/close-day (admin | manager | cashier) */
import type { Context } from "elysia";
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import { closeDay } from "@/services/canteen_service";
import { scopeShop } from "@/services/report_service";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

export const CanteenController = {
	closeDay: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin", "manager", "cashier")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			const effective = scopeShop(user, params.shopId);
			if (!effective) {
				return errorResponse(reqContext, "Not authorized for that shop", ResponseStatus.FORBIDDEN);
			}
			return successResponse(reqContext, await closeDay(effective), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
