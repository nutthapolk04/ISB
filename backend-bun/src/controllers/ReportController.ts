import type { HandlerContext } from "@/controllers/types";
import {
    salesReport,
    salesByPaymentReport,
    stockReport,
    returnsReport,
    stockCardReport,
    salesSummaryReport,
    salesByItemReport,
} from "@/services/report_service";
import { handleServiceError } from "@/utils/ResponseUtil";

export const ReportController = {
    sales: async (ctx: any) => {
        const { query, user, set } = ctx;
        try {
            return await salesReport({
                user,
                dateFrom: query.date_from,
                dateTo: query.date_to,
                shopId: query.shop_id ?? undefined,
                module: query.module ?? undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    salesByPayment: async (ctx: any) => {
        const { query, user, set } = ctx;
        try {
            return await salesByPaymentReport({
                user,
                dateFrom: query.date_from,
                dateTo: query.date_to,
                shopId: query.shop_id ?? undefined,
                module: query.module ?? undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    stock: async (ctx: any) => {
        const { query, user, set } = ctx;
        try {
            return await stockReport({
                user,
                shopId: query.shop_id ?? undefined,
                module: query.module ?? undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    returns: async (ctx: any) => {
        const { query, user, set } = ctx;
        try {
            return await returnsReport({
                user,
                dateFrom: query.date_from,
                dateTo: query.date_to,
                shopId: query.shop_id ?? undefined,
                module: query.module ?? undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    stockCard: async (ctx: any) => {
        const { query, user, set } = ctx;
        try {
            return await stockCardReport({
                user,
                dateFrom: query.date_from,
                dateTo: query.date_to,
                shopId: query.shop_id ?? undefined,
                productVariantId: query.product_variant_id ? Number(query.product_variant_id) : undefined,
                productSearch: query.product_search ?? undefined,
                category: query.category ?? undefined,
                includeEmpty: query.include_empty === "true",
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    salesSummary: async (ctx: any) => {
        const { query, user, set } = ctx;
        try {
            return await salesSummaryReport({
                user,
                dateFrom: query.date_from ?? undefined,
                dateTo: query.date_to ?? undefined,
                customerType: query.customer_type ?? undefined,
                userName: query.user_name ?? undefined,
                familyCode: query.family_code ?? undefined,
                receiptNoFrom: query.receipt_no_from ?? undefined,
                receiptNoTo: query.receipt_no_to ?? undefined,
                receiveType: query.receive_type ?? undefined,
                shopId: query.shop_id ?? undefined,
                module: query.module ?? undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    salesByItem: async (ctx: any) => {
        const { query, user, set } = ctx;
        try {
            return await salesByItemReport({
                user,
                dateFrom: query.date_from ?? undefined,
                dateTo: query.date_to ?? undefined,
                customerType: query.customer_type ?? undefined,
                userName: query.user_name ?? undefined,
                familyCode: query.family_code ?? undefined,
                receiptNoFrom: query.receipt_no_from ?? undefined,
                receiptNoTo: query.receipt_no_to ?? undefined,
                receiveType: query.receive_type ?? undefined,
                shopId: query.shop_id ?? undefined,
                module: query.module ?? undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
