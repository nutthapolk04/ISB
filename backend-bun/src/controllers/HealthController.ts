/** Health check — GET /health (public) */
import type { Context } from "elysia";
import { publicCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { pingDb } from "@/db/client";
import { APP_VERSION } from "@/lib/config";
import { successResponse } from "@/utils/ResponseUtil";

export const HealthController = {
	get: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const dbOk = await pingDb();
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
	},
};
