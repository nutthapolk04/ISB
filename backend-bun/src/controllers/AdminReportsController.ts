/** Admin reports — adjustment, transfer (admin only) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import { adjustmentReport, transferReport, topupReport, transactionReport, kioskLogReport, internalUsedReport } from "@/services/admin_reports_service";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";
import { logger } from "@/logger";

export const AdminReportsController = {
    adjustmentReport: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { query } = reqContext;
        logger.info(`[${reqContext.requestId} (AR-01)] AdminReportsController.adjustmentReport() called.`);
        if (!hasRole(user.roles, "admin", "finance")) {
            logger.warn(`[${reqContext.requestId} (AR-01)] AdminReportsController.adjustmentReport() forbidden.`);
            return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
        }
        const page = query.page ? Math.max(Number(query.page), 1) : 1;
        const pageSize = query.page_size ? Math.min(Math.max(Number(query.page_size), 1), 5000) : 20;
        try {
            logger.info(`[${reqContext.requestId} (AR-01)] AdminReportsController.adjustmentReport() calling adjustmentReport().`);
            const result = await adjustmentReport({
                dateFrom: query.date_from ?? null,
                dateTo: query.date_to ?? null,
                direction: query.direction ?? null,
                typeFilter: query.type ?? null,
                sortOrder: query.sort_order ?? null,
                page,
                pageSize,
            });
            logger.info(`[${reqContext.requestId} (AR-01)] AdminReportsController.adjustmentReport() completed.`);
            return successResponse(reqContext, result, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AR-01)] AdminReportsController.adjustmentReport() error:`, e);
            return errorFromService(reqContext, e);
        }
    },

    transferReport: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { query } = reqContext;
        logger.info(`[${reqContext.requestId} (AR-02)] AdminReportsController.transferReport() called.`);
        if (!hasRole(user.roles, "admin", "finance")) {
            logger.warn(`[${reqContext.requestId} (AR-02)] AdminReportsController.transferReport() forbidden.`);
            return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
        }
        const page = query.page ? Math.max(Number(query.page), 1) : 1;
        const pageSize = query.page_size ? Math.min(Math.max(Number(query.page_size), 1), 200) : 20;
        try {
            logger.info(`[${reqContext.requestId} (AR-02)] AdminReportsController.transferReport() calling transferReport().`);
            const result = await transferReport({
                dateFrom: query.date_from ?? null,
                dateTo: query.date_to ?? null,
                q: query.q ?? null,
                amountMin: query.amount_min ? Number(query.amount_min) : null,
                amountMax: query.amount_max ? Number(query.amount_max) : null,
                sortOrder: query.sort_order ?? null,
                page,
                pageSize,
            });
            logger.info(`[${reqContext.requestId} (AR-02)] AdminReportsController.transferReport() completed.`);
            return successResponse(reqContext, result, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AR-02)] AdminReportsController.transferReport() error:`, e);
            return errorFromService(reqContext, e);
        }
    },

    topupReport: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { query } = reqContext;
        logger.info(`[${reqContext.requestId} (AR-03)] AdminReportsController.topupReport() called.`);
        if (!hasRole(user.roles, "admin", "finance")) {
            logger.warn(`[${reqContext.requestId} (AR-03)] AdminReportsController.topupReport() forbidden.`);
            return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
        }
        const page = query.page ? Math.max(Number(query.page), 1) : 1;
        const pageSize = query.page_size ? Math.min(Math.max(Number(query.page_size), 1), 5000) : 50;
        try {
            const result = await topupReport({
                dateFrom: query.date_from ?? null,
                dateTo: query.date_to ?? null,
                channel: query.channel ?? null,
                toppedByUserId: query.topped_by_user_id ? Number(query.topped_by_user_id) : null,
                toppedByCustomerId: query.topped_by_customer_id ? Number(query.topped_by_customer_id) : null,
                recipientUserId: query.recipient_user_id ? Number(query.recipient_user_id) : null,
                recipientCustomerId: query.recipient_customer_id ? Number(query.recipient_customer_id) : null,
                sortOrder: query.sort_order ?? null,
                page,
                pageSize,
            });
            logger.info(`[${reqContext.requestId} (AR-03)] AdminReportsController.topupReport() completed.`);
            return successResponse(reqContext, result, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AR-03)] AdminReportsController.topupReport() error:`, e);
            return errorFromService(reqContext, e);
        }
    },

    transactionReport: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { query } = reqContext;
        logger.info(`[${reqContext.requestId} (AR-04)] AdminReportsController.transactionReport() called.`);
        if (!hasRole(user.roles, "admin", "finance")) {
            logger.warn(`[${reqContext.requestId} (AR-04)] AdminReportsController.transactionReport() forbidden.`);
            return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
        }
        const page = query.page ? Math.max(Number(query.page), 1) : 1;
        const pageSize = query.page_size ? Math.min(Math.max(Number(query.page_size), 1), 5000) : 50;
        try {
            const result = await transactionReport({
                dateFrom: query.date_from ?? null,
                dateTo: query.date_to ?? null,
                search: query.search ?? null,
                cashierId: query.cashier_id ? Number(query.cashier_id) : null,
                status: query.status ?? null,
                paymentMethod: query.payment_method ?? null,
                shopId: query.shop_id ?? null,
                type: query.type ?? null,
                cashierRole: query.cashier_role ?? null,
                sortOrder: query.sort_order ?? null,
                page,
                pageSize,
            });
            logger.info(`[${reqContext.requestId} (AR-04)] AdminReportsController.transactionReport() completed.`);
            return successResponse(reqContext, result, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AR-04)] AdminReportsController.transactionReport() error:`, e);
            return errorFromService(reqContext, e);
        }
    },

    internalUsedReport: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { query } = reqContext;
        logger.info(`[${reqContext.requestId} (AR-06)] AdminReportsController.internalUsedReport() called.`);
        if (!hasRole(user.roles, "admin", "finance")) {
            logger.warn(`[${reqContext.requestId} (AR-06)] AdminReportsController.internalUsedReport() forbidden.`);
            return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
        }
        try {
            const result = await internalUsedReport({
                dateFrom: query.date_from ?? null,
                dateTo: query.date_to ?? null,
                departmentId: query.department_id ? Number(query.department_id) : null,
                requesterUserId: query.requester_user_id ? Number(query.requester_user_id) : null,
                shopId: query.shop_id ?? null,
                module: query.module ?? null,
                sortOrder: query.sort_order ?? null,
            });
            logger.info(`[${reqContext.requestId} (AR-06)] AdminReportsController.internalUsedReport() completed.`);
            return successResponse(reqContext, result, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AR-06)] AdminReportsController.internalUsedReport() error:`, e);
            return errorFromService(reqContext, e);
        }
    },

    kioskLogReport: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { query } = reqContext;
        logger.info(`[${reqContext.requestId} (AR-05)] AdminReportsController.kioskLogReport() called.`);
        if (!hasRole(user.roles, "admin", "finance")) {
            logger.warn(`[${reqContext.requestId} (AR-05)] AdminReportsController.kioskLogReport() forbidden.`);
            return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
        }
        const page = query.page ? Math.max(Number(query.page), 1) : 1;
        const pageSize = query.page_size ? Math.min(Math.max(Number(query.page_size), 1), 5000) : 50;
        try {
            const result = await kioskLogReport({
                kioskUserId: query.kiosk_user_id ? Number(query.kiosk_user_id) : null,
                dateFrom: query.date_from ?? null,
                dateTo: query.date_to ?? null,
                level: query.level ?? null,
                category: query.category ?? null,
                sortOrder: query.sort_order ?? null,
                page,
                pageSize,
            });
            logger.info(`[${reqContext.requestId} (AR-05)] AdminReportsController.kioskLogReport() completed.`);
            return successResponse(reqContext, result, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AR-05)] AdminReportsController.kioskLogReport() error:`, e);
            return errorFromService(reqContext, e);
        }
    },
};
