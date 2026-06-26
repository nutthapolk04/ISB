import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import { adjustmentReport, transferReport } from "@/services/admin_reports_service";
import { handleServiceError, adminOnly } from "@/utils/ResponseUtil";

export const AdminReportsController = {
    adjustmentReport: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        try {
            return await adjustmentReport({
                dateFrom: query.date_from ?? null,
                dateTo: query.date_to ?? null,
                direction: query.direction ?? null,
                typeFilter: query.type ?? null,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    transferReport: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const page = query.page ? Math.max(Number(query.page), 1) : 1;
        const pageSize = query.page_size ? Math.min(Math.max(Number(query.page_size), 1), 200) : 20;
        try {
            return await transferReport({
                dateFrom: query.date_from ?? null,
                dateTo: query.date_to ?? null,
                page,
                pageSize,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
