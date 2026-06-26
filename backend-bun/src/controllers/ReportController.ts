/** Reports — sales, stock, returns, stock-card (auth) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import {
	salesReport,
	salesByPaymentReport,
	stockReport,
	returnsReport,
	stockCardReport,
	salesSummaryReport,
	salesByItemReport,
} from "@/services/report_service";
import { errorFromService, successResponse } from "@/utils/ResponseUtil";

export const ReportController = {
	sales: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		try {
			return successResponse(
				reqContext,
				await salesReport({
					user,
					dateFrom: query.date_from,
					dateTo: query.date_to,
					shopId: query.shop_id ?? undefined,
					module: query.module ?? undefined,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	salesByPayment: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		try {
			return successResponse(
				reqContext,
				await salesByPaymentReport({
					user,
					dateFrom: query.date_from,
					dateTo: query.date_to,
					shopId: query.shop_id ?? undefined,
					module: query.module ?? undefined,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	stock: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		try {
			return successResponse(
				reqContext,
				await stockReport({
					user,
					shopId: query.shop_id ?? undefined,
					module: query.module ?? undefined,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	returns: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		try {
			return successResponse(
				reqContext,
				await returnsReport({
					user,
					dateFrom: query.date_from,
					dateTo: query.date_to,
					shopId: query.shop_id ?? undefined,
					module: query.module ?? undefined,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	stockCard: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		try {
			return successResponse(
				reqContext,
				await stockCardReport({
					user,
					dateFrom: query.date_from,
					dateTo: query.date_to,
					shopId: query.shop_id ?? undefined,
					productVariantId: query.product_variant_id ? Number(query.product_variant_id) : undefined,
					productSearch: query.product_search ?? undefined,
					category: query.category ?? undefined,
					includeEmpty: query.include_empty === "true",
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	salesSummary: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		try {
			return successResponse(
				reqContext,
				await salesSummaryReport({
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
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	salesByItem: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		try {
			return successResponse(
				reqContext,
				await salesByItemReport({
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
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
