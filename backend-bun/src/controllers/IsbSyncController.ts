/** ISB → vendor sync batches — staffs, families, departments (public; x-api-key) */
import { publicCtx } from "@/interfaces/ServiceRequest";
import { logger } from "@/logger";
import {
	checkApiKey,
	syncAuthFailed,
	syncProcessingFailed,
	syncSuccess,
} from "@/lib/isb_sync_response";
import {
	processDepartmentBatch,
	processFamilyBatch,
	processStaffBatch,
} from "@/services/isb_sync_service";

async function handleBatchResult(
	set: { status?: number | string },
	result: { success: number; failed: number; errors: Array<{ index: number; id: string | number; error: string }> },
) {
	if (result.failed > 0) {
		return syncProcessingFailed(set, result.errors);
	}
	return syncSuccess();
}

export const IsbSyncController = {
	staffs: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const { body, headers } = reqContext;
		logger.info(`[${reqContext.requestId} (IS-01)] IsbSyncController.staffs() called.`);
		if (!checkApiKey(headers as Record<string, string | undefined>)) {
			logger.warn(`[${reqContext.requestId} (IS-01)] IsbSyncController.staffs() auth failed.`);
			return syncAuthFailed(reqContext.set);
		}
		try {
			logger.info(`[${reqContext.requestId} (IS-01)] IsbSyncController.staffs() calling processStaffBatch().`);
			const result = await processStaffBatch(body.staffs);
			logger.info(`[${reqContext.requestId} (IS-01)] IsbSyncController.staffs() completed.`);
			return await handleBatchResult(reqContext.set, result);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (IS-01)] IsbSyncController.staffs() error:`, e);
			reqContext.set.status = 500;
			return {
				status: "FAILED" as const,
				code: "500",
				message: (e as Error).message,
			};
		}
	},

	families: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const { body, headers } = reqContext;
		logger.info(`[${reqContext.requestId} (IS-02)] IsbSyncController.families() called.`);
		if (!checkApiKey(headers as Record<string, string | undefined>)) {
			logger.warn(`[${reqContext.requestId} (IS-02)] IsbSyncController.families() auth failed.`);
			return syncAuthFailed(reqContext.set);
		}
		try {
			logger.info(`[${reqContext.requestId} (IS-02)] IsbSyncController.families() calling processFamilyBatch().`);
			const result = await processFamilyBatch(body.families);
			logger.info(`[${reqContext.requestId} (IS-02)] IsbSyncController.families() completed.`);
			return await handleBatchResult(reqContext.set, result);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (IS-02)] IsbSyncController.families() error:`, e);
			reqContext.set.status = 500;
			return {
				status: "FAILED" as const,
				code: "500",
				message: (e as Error).message,
			};
		}
	},

	departments: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const { body, headers } = reqContext;
		logger.info(`[${reqContext.requestId} (IS-03)] IsbSyncController.departments() called.`);
		if (!checkApiKey(headers as Record<string, string | undefined>)) {
			logger.warn(`[${reqContext.requestId} (IS-03)] IsbSyncController.departments() auth failed.`);
			return syncAuthFailed(reqContext.set);
		}
		try {
			logger.info(`[${reqContext.requestId} (IS-03)] IsbSyncController.departments() calling processDepartmentBatch().`);
			const result = await processDepartmentBatch(body.departments);
			logger.info(`[${reqContext.requestId} (IS-03)] IsbSyncController.departments() completed.`);
			return await handleBatchResult(reqContext.set, result);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (IS-03)] IsbSyncController.departments() error:`, e);
			reqContext.set.status = 500;
			return {
				status: "FAILED" as const,
				code: "500",
				message: (e as Error).message,
			};
		}
	},
};
