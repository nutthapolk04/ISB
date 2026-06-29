/** PowerSchool / cardholder sync — run, logs, stats, audit (auth: admin | manager) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import { listSyncLogs, syncStats } from "@/services/sync_log_service";
import { getSyncLog, listSyncStatuses, listSyncAudit } from "@/services/cardholder_service";
import { runSync } from "@/services/powerschool_sync";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";
import { logger } from "@/logger";

export const SyncController = {
	run: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (SY-01)] SyncController.run() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (SY-01)] SyncController.run() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SY-01)] SyncController.run() calling runSync().`);
			const result = await runSync({
				triggeredById: Number(user.sub),
				syncType: (body.sync_type as "full" | "delta") ?? "delta",
				targetRoles: body.target_roles ?? ["student", "parent", "staff"],
			});
			logger.info(`[${reqContext.requestId} (SY-01)] SyncController.run() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SY-01)] SyncController.run() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	powerschool: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (SY-02)] SyncController.powerschool() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (SY-02)] SyncController.powerschool() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const valid = new Set(["student", "parent", "staff", "admin", "manager", "cashier"]);
		const targetRoles = (body.target_roles ?? []).filter((r: string) => valid.has(r));
		if (targetRoles.length === 0) {
			logger.warn(`[${reqContext.requestId} (SY-02)] SyncController.powerschool() invalid target roles.`);
			return errorResponse(reqContext, "At least one valid target role is required", ResponseStatus.BAD_REQUEST);
		}
		try {
			logger.info(`[${reqContext.requestId} (SY-02)] SyncController.powerschool() calling runSync().`);
			const result = await runSync({
				triggeredById: Number(user.sub),
				syncType: (body.sync_type as "full" | "delta") ?? "full",
				targetRoles,
			});
			logger.info(`[${reqContext.requestId} (SY-02)] SyncController.powerschool() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SY-02)] SyncController.powerschool() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	logs: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (SY-03)] SyncController.logs() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (SY-03)] SyncController.logs() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SY-03)] SyncController.logs() calling listSyncLogs().`);
			const result = await listSyncLogs(
				query.limit ? Math.min(Math.max(Number(query.limit), 1), 200) : 50,
				query.offset ? Math.max(Number(query.offset), 0) : 0,
			);
			logger.info(`[${reqContext.requestId} (SY-03)] SyncController.logs() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SY-03)] SyncController.logs() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	stats: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (SY-04)] SyncController.stats() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (SY-04)] SyncController.stats() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			const days = query.days ? Math.min(Math.max(Number(query.days), 1), 365) : 30;
			logger.info(`[${reqContext.requestId} (SY-04)] SyncController.stats() calling syncStats().`);
			const result = await syncStats(days);
			logger.info(`[${reqContext.requestId} (SY-04)] SyncController.stats() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SY-04)] SyncController.stats() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	listSyncLogs: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (SY-05)] SyncController.listSyncLogs() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SY-05)] SyncController.listSyncLogs() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			const limit = query.limit ? Math.min(Math.max(Number(query.limit), 1), 200) : 20;
			logger.info(`[${reqContext.requestId} (SY-05)] SyncController.listSyncLogs() calling listSyncStatuses().`);
			const result = await listSyncStatuses(limit);
			logger.info(`[${reqContext.requestId} (SY-05)] SyncController.listSyncLogs() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SY-05)] SyncController.listSyncLogs() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getSyncLog: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SY-06)] SyncController.getSyncLog() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SY-06)] SyncController.getSyncLog() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.syncLogId, "sync_log_id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (SY-06)] SyncController.getSyncLog() invalid sync_log_id.`);
			return errorResponse(reqContext, "Invalid sync_log_id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (SY-06)] SyncController.getSyncLog() calling getSyncLog().`);
			const result = await getSyncLog(id);
			logger.info(`[${reqContext.requestId} (SY-06)] SyncController.getSyncLog() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SY-06)] SyncController.getSyncLog() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	syncAudit: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, query } = reqContext;
		logger.info(`[${reqContext.requestId} (SY-07)] SyncController.syncAudit() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SY-07)] SyncController.syncAudit() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.syncLogId, "sync_log_id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (SY-07)] SyncController.syncAudit() invalid sync_log_id.`);
			return errorResponse(reqContext, "Invalid sync_log_id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (SY-07)] SyncController.syncAudit() calling listSyncAudit().`);
			const result = await listSyncAudit(id, query.action ?? null);
			logger.info(`[${reqContext.requestId} (SY-07)] SyncController.syncAudit() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SY-07)] SyncController.syncAudit() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
