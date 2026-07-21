/** PowerSchool / cardholder sync — run, logs, stats, audit (auth: admin | manager) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import { listSyncLogs, syncStats } from "@/services/sync_log_service";
import { getSyncLog, listSyncStatuses, listSyncAudit } from "@/services/cardholder_service";
import {
	processDepartmentBatch,
	processFamilyBatch,
	processStaffBatch,
	type IsbDepartment,
	type IsbFamily,
	type IsbStaff,
} from "@/services/isb_sync_service";
import { listRounds, loadRoundRecords, type SyncChannel } from "@/services/sync_capture_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";
import { logger } from "@/logger";

/**
 * A captured round concatenates every original batch call in that window —
 * unlike a single real ISB batch, the SAME record (e.g. a family swapped
 * twice within the hour) can legitimately appear more than once across those
 * batches. processFamilyBatch/etc. upsert concurrently in chunks (see
 * isb_sync_service.ts::processInChunks) — replaying two records for the same
 * key in one call races on their shared insert (e.g. duplicate-key on
 * family_profiles.family_code). Keeping only the LAST occurrence per key
 * converges to the same end state a real, race-free sequential replay would
 * reach, while removing the race.
 */
function dedupeByKeyKeepLast<T>(records: T[], keyOf: (r: T) => string | number): T[] {
	const byKey = new Map<string | number, T>();
	for (const r of records) byKey.set(keyOf(r), r);
	return [...byKey.values()];
}

export const SyncController = {
	/** List captured ISB sync rounds for a channel (families/staffs/departments) — see sync_capture_service.ts. */
	listCaptures: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SY-01)] SyncController.listCaptures() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (SY-01)] SyncController.listCaptures() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SY-01)] SyncController.listCaptures() calling listRounds().`);
			const result = await listRounds(params.channel as SyncChannel);
			logger.info(`[${reqContext.requestId} (SY-01)] SyncController.listCaptures() completed.`);
			return successResponse(reqContext, { items: result }, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SY-01)] SyncController.listCaptures() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	/** Preview every record captured in one round (all its batches concatenated) before Manual Sync. */
	previewCapture: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SY-02)] SyncController.previewCapture() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (SY-02)] SyncController.previewCapture() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SY-02)] SyncController.previewCapture() calling loadRoundRecords().`);
			const records = await loadRoundRecords(params.channel as SyncChannel, params.roundId);
			logger.info(`[${reqContext.requestId} (SY-02)] SyncController.previewCapture() completed.`);
			return successResponse(reqContext, { count: records.length, records }, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SY-02)] SyncController.previewCapture() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	/**
	 * Manual Sync — replays a captured round's records through the SAME real
	 * upsert path a live ISB batch uses (processFamilyBatch/processStaffBatch/
	 * processDepartmentBatch), tagged with triggered_by = the calling admin so
	 * sync_logs distinguishes it from a real ISB-triggered sync.
	 */
	runCapture: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SY-08)] SyncController.runCapture() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (SY-08)] SyncController.runCapture() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			const channel = params.channel as SyncChannel;
			logger.info(`[${reqContext.requestId} (SY-08)] SyncController.runCapture() loading captured records.`);
			const rawRecords = await loadRoundRecords(channel, params.roundId);
			const triggeredById = Number(user.sub);
			logger.info(`[${reqContext.requestId} (SY-08)] SyncController.runCapture() running ${channel} Manual Sync (${rawRecords.length} records).`);
			const result = channel === "families"
				? await processFamilyBatch(dedupeByKeyKeepLast(rawRecords as IsbFamily[], (f) => f.familyCode), triggeredById)
				: channel === "staffs"
					? await processStaffBatch(dedupeByKeyKeepLast(rawRecords as IsbStaff[], (s) => s.customerId), triggeredById)
					: await processDepartmentBatch(dedupeByKeyKeepLast(rawRecords as IsbDepartment[], (d) => d.departmentId), triggeredById);
			logger.info(`[${reqContext.requestId} (SY-08)] SyncController.runCapture() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SY-08)] SyncController.runCapture() error:`, e);
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
