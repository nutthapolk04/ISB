/** Admin reports — adjustment, transfer (admin only) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import { adjustmentReport, transferReport, topupReport, transactionReport } from "@/services/admin_reports_service";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";
import { logger } from "@/logger";

export const AdminReportsController = {
    adjustmentReport: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { query } = reqContext;
        logger.info(`[${reqContext.requestId} (AR-01)] AdminReportsController.adjustmentReport() called.`);
        if (!hasRole(user.roles, "admin")) {
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
        if (!hasRole(user.roles, "admin")) {
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
        if (!hasRole(user.roles, "admin")) {
            logger.warn(`[${reqContext.requestId} (AR-03)] AdminReportsController.topupReport() forbidden.`);
            return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
        }
        try {
            const result = await topupReport({
                dateFrom: query.date_from ?? null,
                dateTo: query.date_to ?? null,
                channel: query.channel ?? null,
                toppedByUserId: query.topped_by_user_id ? Number(query.topped_by_user_id) : null,
                toppedByCustomerId: query.topped_by_customer_id ? Number(query.topped_by_customer_id) : null,
                recipientUserId: query.recipient_user_id ? Number(query.recipient_user_id) : null,
                recipientCustomerId: query.recipient_customer_id ? Number(query.recipient_customer_id) : null,
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
        if (!hasRole(user.roles, "admin")) {
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
};
