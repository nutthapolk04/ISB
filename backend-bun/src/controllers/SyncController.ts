import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import { listSyncLogs, syncStats } from "@/services/sync_log_service";
import { getSyncLog, listSyncStatuses, listSyncAudit } from "@/services/cardholder_service";
import { runSync } from "@/services/powerschool_sync";
import { handleServiceError, forbidden, adminOnly } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

export const SyncController = {
    run: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        try {
            return await runSync({
                triggeredById: Number(user.sub),
                syncType: (body.sync_type as "full" | "delta") ?? "delta",
                targetRoles: body.target_roles ?? ["student", "parent", "staff"],
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    powerschool: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const valid = new Set(["student", "parent", "staff", "admin", "manager", "cashier"]);
        const targetRoles = (body.target_roles ?? []).filter((r: string) => valid.has(r));
        if (targetRoles.length === 0) {
            set.status = 400;
            return { detail: "At least one valid target role is required" };
        }
        try {
            return await runSync({
                triggeredById: Number(user.sub),
                syncType: (body.sync_type as "full" | "delta") ?? "full",
                targetRoles,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    logs: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        try {
            return await listSyncLogs(
                query.limit ? Math.min(Math.max(Number(query.limit), 1), 200) : 50,
                query.offset ? Math.max(Number(query.offset), 0) : 0,
            );
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    stats: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        try {
            const days = query.days ? Math.min(Math.max(Number(query.days), 1), 365) : 30;
            return await syncStats(days);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    listSyncLogs: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return forbidden(set);
        try {
            const limit = query.limit ? Math.min(Math.max(Number(query.limit), 1), 200) : 20;
            return await listSyncStatuses(limit);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    getSyncLog: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return forbidden(set);
        const id = parseIntParam(params.syncLogId, "sync_log_id", set);
        if (id === null) return { detail: "Invalid sync_log_id" };
        try {
            return await getSyncLog(id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    syncAudit: async (ctx: any) => {
        const { params, query, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return forbidden(set);
        const id = parseIntParam(params.syncLogId, "sync_log_id", set);
        if (id === null) return { detail: "Invalid sync_log_id" };
        try {
            return await listSyncAudit(id, query.action ?? null);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
