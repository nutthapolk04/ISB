/** PowerSchool / cardholder sync — run, logs, stats, audit (auth: admin | manager) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import { listSyncLogs, syncStats } from "@/services/sync_log_service";
import { getSyncLog, listSyncStatuses, listSyncAudit } from "@/services/cardholder_service";
import { runSync } from "@/services/powerschool_sync";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

export const SyncController = {
	run: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await runSync({
					triggeredById: Number(user.sub),
					syncType: (body.sync_type as "full" | "delta") ?? "delta",
					targetRoles: body.target_roles ?? ["student", "parent", "staff"],
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	powerschool: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const valid = new Set(["student", "parent", "staff", "admin", "manager", "cashier"]);
		const targetRoles = (body.target_roles ?? []).filter((r: string) => valid.has(r));
		if (targetRoles.length === 0) {
			return errorResponse(reqContext, "At least one valid target role is required", ResponseStatus.BAD_REQUEST);
		}
		try {
			return successResponse(
				reqContext,
				await runSync({
					triggeredById: Number(user.sub),
					syncType: (body.sync_type as "full" | "delta") ?? "full",
					targetRoles,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	logs: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await listSyncLogs(
					query.limit ? Math.min(Math.max(Number(query.limit), 1), 200) : 50,
					query.offset ? Math.max(Number(query.offset), 0) : 0,
				),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	stats: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			const days = query.days ? Math.min(Math.max(Number(query.days), 1), 365) : 30;
			return successResponse(reqContext, await syncStats(days), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	listSyncLogs: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			const limit = query.limit ? Math.min(Math.max(Number(query.limit), 1), 200) : 20;
			return successResponse(reqContext, await listSyncStatuses(limit), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	getSyncLog: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.syncLogId, "sync_log_id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid sync_log_id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await getSyncLog(id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	syncAudit: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, query } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.syncLogId, "sync_log_id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid sync_log_id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await listSyncAudit(id, query.action ?? null), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
