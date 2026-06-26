/**
 * Admin audit logs — GET /admin/audit-logs
 * Auth: admin | manager | cashier (managers/cashiers scoped to shop_id)
 */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { logger } from "@/logger";
import { hasRole } from "@/middleware/AuthMiddleware";
import { listAuditLogs } from "@/services/audit_log_service";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

export const AdminAuditController = {
    listAuditLogs: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { query } = reqContext;
        logger.info(`[${reqContext.requestId} (AA-01)] AdminAuditController.listAuditLogs() called.`);
        if (!hasRole(user.roles, "admin", "manager", "cashier")) {
            logger.warn(`[${reqContext.requestId} (AA-01)] AdminAuditController.listAuditLogs() forbidden.`);
            return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
        }
        const callerIsAdmin = hasRole(user.roles, "admin") || user.is_superuser;
        try {
            logger.info(`[${reqContext.requestId} (AA-01)] AdminAuditController.listAuditLogs() calling listAuditLogs().`);
            const data = await listAuditLogs({
                entityType: query.entity_type,
                action: query.action,
                userId: query.user_id ? Number(query.user_id) : undefined,
                shopId: query.shop_id,
                dateFrom: query.date_from,
                dateTo: query.date_to,
                page: query.page ? Number(query.page) : undefined,
                pageSize: query.page_size ? Number(query.page_size) : undefined,
                callerIsAdmin,
                callerShopId: user.shop_id ?? null,
            });
            logger.info(`[${reqContext.requestId} (AA-01)] AdminAuditController.listAuditLogs() completed.`);
            return successResponse(reqContext, data, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AA-01)] AdminAuditController.listAuditLogs() error:`, e);
            return errorFromService(reqContext, e);
        }
    },
};
