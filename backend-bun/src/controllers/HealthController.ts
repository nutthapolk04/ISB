/** Health check — GET /health (public) */
import { publicCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { pingDb } from "@/db/client";
import { APP_VERSION } from "@/lib/config";
import { logger } from "@/logger";
import { successResponse } from "@/utils/ResponseUtil";

export const HealthController = {
	get: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		logger.info(`[${reqContext.requestId} (HC-01)] HealthController.get() called.`);
		try {
			logger.info(`[${reqContext.requestId} (HC-01)] HealthController.get() calling pingDb().`);
			const dbOk = await pingDb();
			logger.info(`[${reqContext.requestId} (HC-01)] HealthController.get() completed.`);
			return successResponse(
				reqContext,
				{
					status: dbOk ? "ok" : "degraded",
					version: APP_VERSION,
					service: "isb-backend-bun",
					db: dbOk ? "up" : "down",
					timestamp: new Date().toISOString(),
				},
				ResponseStatus.OK,
			);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (HC-01)] HealthController.get() error:`, e);
			throw e;
		}
	},
};
