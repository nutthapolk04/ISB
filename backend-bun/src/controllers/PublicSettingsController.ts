/** Public settings — GET /public/settings, /public/school (no auth) */
import type { Context } from "elysia";
import { publicCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { getPublicSettings, getSchoolSettings } from "@/services/settings_service";
import { successResponse } from "@/utils/ResponseUtil";

export const PublicSettingsController = {
	getPublicSettings: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		return successResponse(reqContext, await getPublicSettings(), ResponseStatus.OK);
	},

	getSchoolSettings: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		return successResponse(reqContext, await getSchoolSettings(), ResponseStatus.OK);
	},
};
