/** Admin reports — adjustment, transfer (admin only) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import { adjustmentReport, transferReport, topupReport, transactionReport, kioskLogReport, internalUsedReport, lowBalanceAlertReport ,balanceReport} from "@/services/admin_reports_service";
import { sendSingleLowBalanceAlert } from "@/services/low_balance_notification";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { logger } from "@/logger";

/**
 * Hard stop for `page_size=all`. Beyond this the browser building the file is
 * what falls over, so refuse loudly — a silently short export is the failure
 * mode this whole mechanism exists to remove.
 */
export const EXPORT_ROW_CEILING = 100_000;

/**
 * Resolve `page_size` for a paginated report.
 *
 * `page_size=all` returns the entire filtered result set in one call. The
 * exports need every row, and each of these services already builds the whole
 * set in memory before slicing a page out of it, so fetching page by page would
 * re-run the same query once per page for no benefit.
 *
 * It requires an explicit date range: without one, "all" means the entire
 * history of the school.
 */
export function resolvePageSize(
    query: Record<string, string | undefined>,
    opts: { cap: number; fallback: number },
): { pageSize: number; unlimited: true } | { pageSize: number; unlimited: false } | { error: string } {
    const raw = (query.page_size ?? "").trim().toLowerCase();
    if (raw === "all") {
        if (!query.date_from || !query.date_to) {
            return { error: "page_size=all requires both date_from and date_to." };
        }
        return { pageSize: EXPORT_ROW_CEILING, unlimited: true };
    }
    if (!raw) return { pageSize: opts.fallback, unlimited: false };
    return { pageSize: Math.min(Math.max(Number(raw), 1), opts.cap), unlimited: false };
}

/** The message a caller sees when an unlimited export would exceed the ceiling. */
function overCeiling(total: number): string {
    return `This export would contain ${total.toLocaleString("en-US")} rows, over the ${EXPORT_ROW_CEILING.toLocaleString("en-US")} limit. Narrow the date range and try again.`;
}

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
        const ps = resolvePageSize(query, { cap: 5000, fallback: 20 });
        if ("error" in ps) return errorResponse(reqContext, ps.error, ResponseStatus.BAD_REQUEST);
        try {
            logger.info(`[${reqContext.requestId} (AR-01)] AdminReportsController.adjustmentReport() calling adjustmentReport().`);
            const result = await adjustmentReport({
                dateFrom: query.date_from ?? null,
                dateTo: query.date_to ?? null,
                direction: query.direction ?? null,
                typeFilter: query.type ?? null,
                sortOrder: query.sort_order ?? null,
                page: ps.unlimited ? 1 : page,
                pageSize: ps.pageSize,
            });
            if (ps.unlimited && result.total > EXPORT_ROW_CEILING) {
                return errorResponse(reqContext, overCeiling(result.total), ResponseStatus.BAD_REQUEST);
            }
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
        // Was capped at 200 — low enough that a busy month's export lost rows
        // silently. Same ceiling as the other reports now, plus page_size=all.
        const ps = resolvePageSize(query, { cap: 5000, fallback: 20 });
        if ("error" in ps) return errorResponse(reqContext, ps.error, ResponseStatus.BAD_REQUEST);
        try {
            logger.info(`[${reqContext.requestId} (AR-02)] AdminReportsController.transferReport() calling transferReport().`);
            const result = await transferReport({
                dateFrom: query.date_from ?? null,
                dateTo: query.date_to ?? null,
                q: query.q ?? null,
                amountMin: query.amount_min ? Number(query.amount_min) : null,
                amountMax: query.amount_max ? Number(query.amount_max) : null,
                sortOrder: query.sort_order ?? null,
                page: ps.unlimited ? 1 : page,
                pageSize: ps.pageSize,
            });
            if (ps.unlimited && result.total > EXPORT_ROW_CEILING) {
                return errorResponse(reqContext, overCeiling(result.total), ResponseStatus.BAD_REQUEST);
            }
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
        const ps = resolvePageSize(query, { cap: 5000, fallback: 50 });
        if ("error" in ps) return errorResponse(reqContext, ps.error, ResponseStatus.BAD_REQUEST);
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
                page: ps.unlimited ? 1 : page,
                pageSize: ps.pageSize,
            });
            if (ps.unlimited && result.total > EXPORT_ROW_CEILING) {
                return errorResponse(reqContext, overCeiling(result.total), ResponseStatus.BAD_REQUEST);
            }
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
        const ps = resolvePageSize(query, { cap: 5000, fallback: 50 });
        if ("error" in ps) return errorResponse(reqContext, ps.error, ResponseStatus.BAD_REQUEST);
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
                page: ps.unlimited ? 1 : page,
                pageSize: ps.pageSize,
            });
            if (ps.unlimited && result.total > EXPORT_ROW_CEILING) {
                return errorResponse(reqContext, overCeiling(result.total), ResponseStatus.BAD_REQUEST);
            }
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
        const ps = resolvePageSize(query, { cap: 5000, fallback: 50 });
        if ("error" in ps) return errorResponse(reqContext, ps.error, ResponseStatus.BAD_REQUEST);
        try {
            const result = await kioskLogReport({
                kioskUserId: query.kiosk_user_id ? Number(query.kiosk_user_id) : null,
                dateFrom: query.date_from ?? null,
                dateTo: query.date_to ?? null,
                level: query.level ?? null,
                category: query.category ?? null,
                sortOrder: query.sort_order ?? null,
                page: ps.unlimited ? 1 : page,
                pageSize: ps.pageSize,
            });
            if (ps.unlimited && result.total > EXPORT_ROW_CEILING) {
                return errorResponse(reqContext, overCeiling(result.total), ResponseStatus.BAD_REQUEST);
            }
            logger.info(`[${reqContext.requestId} (AR-05)] AdminReportsController.kioskLogReport() completed.`);
            return successResponse(reqContext, result, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AR-05)] AdminReportsController.kioskLogReport() error:`, e);
            return errorFromService(reqContext, e);
        }
    },

    lowBalanceAlertReport: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { query } = reqContext;
        logger.info(`[${reqContext.requestId} (AR-06)] AdminReportsController.lowBalanceAlertReport() called.`);
        if (!hasRole(user.roles, "admin", "finance")) {
            logger.warn(`[${reqContext.requestId} (AR-06)] AdminReportsController.lowBalanceAlertReport() forbidden.`);
            return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
        }
        const page = query.page ? Math.max(Number(query.page), 1) : 1;
        const ps = resolvePageSize(query, { cap: 5000, fallback: 10 });
        if ("error" in ps) return errorResponse(reqContext, ps.error, ResponseStatus.BAD_REQUEST);
        try {
            const result = await lowBalanceAlertReport({
                dateFrom: query.date_from ?? null,
                dateTo: query.date_to ?? null,
                status: query.status ?? null,
                sortOrder: query.sort_order ?? null,
                page: ps.unlimited ? 1 : page,
                pageSize: ps.pageSize,
            });
            if (ps.unlimited && result.total > EXPORT_ROW_CEILING) {
                return errorResponse(reqContext, overCeiling(result.total), ResponseStatus.BAD_REQUEST);
            }
            logger.info(`[${reqContext.requestId} (AR-06)] AdminReportsController.lowBalanceAlertReport() completed.`);
            return successResponse(reqContext, result, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AR-06)] AdminReportsController.lowBalanceAlertReport() error:`, e);
            return errorFromService(reqContext, e);
        }
    },
    sendLowBalanceAlertNow: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { params } = reqContext;
        logger.info(`[${reqContext.requestId} (AR-07)] AdminReportsController.sendLowBalanceAlertNow() called.`);
        if (!hasRole(user.roles, "admin", "finance")) {
            logger.warn(`[${reqContext.requestId} (AR-07)] AdminReportsController.sendLowBalanceAlertNow() forbidden.`);
            return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
        }
        const id = parseIntParam(params.id, "alert id", reqContext.set);
        if (id === null) {
            logger.warn(`[${reqContext.requestId} (AR-07)] AdminReportsController.sendLowBalanceAlertNow() invalid alert id.`);
            return errorResponse(reqContext, "Invalid alert id", ResponseStatus.UNPROCESSABLE);
        }
        try {
            await sendSingleLowBalanceAlert(id);
            logger.info(`[${reqContext.requestId} (AR-07)] AdminReportsController.sendLowBalanceAlertNow() completed.`);
            return successResponse(reqContext, { ok: true }, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AR-07)] AdminReportsController.sendLowBalanceAlertNow() error:`, e);
            return errorFromService(reqContext, e);
        }
    },
    balanceReport: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { query } = reqContext;
        logger.info(`[${reqContext.requestId} (AR-07)] AdminReportsController.balanceReport() called.`);
        if (!hasRole(user.roles, "admin", "finance")) {
            logger.warn(`[${reqContext.requestId} (AR-07)] AdminReportsController.balanceReport() forbidden.`);
            return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
        }
        const page = query.page ? Math.max(Number(query.page), 1) : 1;
        const ps = resolvePageSize(query, { cap: 5000, fallback: 50 });
        if ("error" in ps) return errorResponse(reqContext, ps.error, ResponseStatus.BAD_REQUEST);
        try {
            logger.info(`[${reqContext.requestId} (AR-07)] AdminReportsController.balanceReport() calling balanceReport().`);
            const result = await balanceReport({
                dateFrom: query.date_from ?? null,
                dateTo: query.date_to ?? null,
                type: query.type ?? null,
                role: query.role ?? null,
                externalId: query.external_id ?? null,
                sortOrder: query.sort_order ?? null,
                page: ps.unlimited ? 1 : page,
                pageSize: ps.pageSize,
            });
            if (ps.unlimited && result.total > EXPORT_ROW_CEILING) {
                return errorResponse(reqContext, overCeiling(result.total), ResponseStatus.BAD_REQUEST);
            }
            logger.info(`[${reqContext.requestId} (AR-07)] AdminReportsController.balanceReport() completed.`);
            return successResponse(reqContext, result, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AR-07)] AdminReportsController.balanceReport() error:`, e);
            return errorFromService(reqContext, e);
        }
    }
};
