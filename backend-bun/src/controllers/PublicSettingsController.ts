/** Public settings — GET /public/settings, /public/school (no auth) */
import { publicCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { logger } from "@/logger";
import { getPublicSettings, getSchoolSettings } from "@/services/settings_service";
import { errorFromService, successResponse } from "@/utils/ResponseUtil";

export const PublicSettingsController = {
	getPublicSettings: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		logger.info(`[${reqContext.requestId} (PS-01)] PublicSettingsController.getPublicSettings() called.`);
		try {
			logger.info(`[${reqContext.requestId} (PS-01)] PublicSettingsController.getPublicSettings() calling getPublicSettings().`);
			const result = await getPublicSettings();
			logger.info(`[${reqContext.requestId} (PS-01)] PublicSettingsController.getPublicSettings() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PS-01)] PublicSettingsController.getPublicSettings() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getSchoolSettings: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		logger.info(`[${reqContext.requestId} (PS-02)] PublicSettingsController.getSchoolSettings() called.`);
		try {
			logger.info(`[${reqContext.requestId} (PS-02)] PublicSettingsController.getSchoolSettings() calling getSchoolSettings().`);
			const result = await getSchoolSettings();
			logger.info(`[${reqContext.requestId} (PS-02)] PublicSettingsController.getSchoolSettings() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PS-02)] PublicSettingsController.getSchoolSettings() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
