/** Admin — kiosk online/offline monitoring + custodian assignment (admin only) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import { listKiosksForAdmin, setKioskCustodians } from "@/services/kiosk_monitoring_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";
import { logger } from "@/logger";

export const KioskMonitoringController = {
	list: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		logger.info(`[${reqContext.requestId} (KM-01)] KioskMonitoringController.list() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (KM-01)] KioskMonitoringController.list() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			const result = await listKiosksForAdmin();
			logger.info(`[${reqContext.requestId} (KM-01)] KioskMonitoringController.list() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (KM-01)] KioskMonitoringController.list() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	setCustodians: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (KM-02)] KioskMonitoringController.setCustodians() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (KM-02)] KioskMonitoringController.setCustodians() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const kioskUserId = parseIntParam(params.kiosk_user_id, "kiosk user id", reqContext.set);
		if (kioskUserId === null) {
			return errorResponse(reqContext, "Invalid kiosk user id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			const result = await setKioskCustodians(kioskUserId, body.custodian_user_ids);
			logger.info(`[${reqContext.requestId} (KM-02)] KioskMonitoringController.setCustodians() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (KM-02)] KioskMonitoringController.setCustodians() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
