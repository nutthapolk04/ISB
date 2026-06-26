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
import { logger } from "@/logger";

export const ReportController = {
	sales: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (RP-01)] ReportController.sales() called.`);
		try {
			logger.info(`[${reqContext.requestId} (RP-01)] ReportController.sales() calling salesReport().`);
			const result = await salesReport({
				user,
				dateFrom: query.date_from,
				dateTo: query.date_to,
				shopId: query.shop_id ?? undefined,
				module: query.module ?? undefined,
			});
			logger.info(`[${reqContext.requestId} (RP-01)] ReportController.sales() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RP-01)] ReportController.sales() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	salesByPayment: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (RP-02)] ReportController.salesByPayment() called.`);
		try {
			logger.info(`[${reqContext.requestId} (RP-02)] ReportController.salesByPayment() calling salesByPaymentReport().`);
			const result = await salesByPaymentReport({
				user,
				dateFrom: query.date_from,
				dateTo: query.date_to,
				shopId: query.shop_id ?? undefined,
				module: query.module ?? undefined,
			});
			logger.info(`[${reqContext.requestId} (RP-02)] ReportController.salesByPayment() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RP-02)] ReportController.salesByPayment() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	stock: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (RP-03)] ReportController.stock() called.`);
		try {
			logger.info(`[${reqContext.requestId} (RP-03)] ReportController.stock() calling stockReport().`);
			const result = await stockReport({
				user,
				shopId: query.shop_id ?? undefined,
				module: query.module ?? undefined,
			});
			logger.info(`[${reqContext.requestId} (RP-03)] ReportController.stock() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RP-03)] ReportController.stock() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	returns: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (RP-04)] ReportController.returns() called.`);
		try {
			logger.info(`[${reqContext.requestId} (RP-04)] ReportController.returns() calling returnsReport().`);
			const result = await returnsReport({
				user,
				dateFrom: query.date_from,
				dateTo: query.date_to,
				shopId: query.shop_id ?? undefined,
				module: query.module ?? undefined,
			});
			logger.info(`[${reqContext.requestId} (RP-04)] ReportController.returns() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RP-04)] ReportController.returns() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	stockCard: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (RP-05)] ReportController.stockCard() called.`);
		try {
			logger.info(`[${reqContext.requestId} (RP-05)] ReportController.stockCard() calling stockCardReport().`);
			const result = await stockCardReport({
				user,
				dateFrom: query.date_from,
				dateTo: query.date_to,
				shopId: query.shop_id ?? undefined,
				productVariantId: query.product_variant_id ? Number(query.product_variant_id) : undefined,
				productSearch: query.product_search ?? undefined,
				category: query.category ?? undefined,
				includeEmpty: query.include_empty === "true",
			});
			logger.info(`[${reqContext.requestId} (RP-05)] ReportController.stockCard() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RP-05)] ReportController.stockCard() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	salesSummary: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (RP-06)] ReportController.salesSummary() called.`);
		try {
			logger.info(`[${reqContext.requestId} (RP-06)] ReportController.salesSummary() calling salesSummaryReport().`);
			const result = await salesSummaryReport({
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
			logger.info(`[${reqContext.requestId} (RP-06)] ReportController.salesSummary() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RP-06)] ReportController.salesSummary() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	salesByItem: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (RP-07)] ReportController.salesByItem() called.`);
		try {
			logger.info(`[${reqContext.requestId} (RP-07)] ReportController.salesByItem() calling salesByItemReport().`);
			const result = await salesByItemReport({
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
			logger.info(`[${reqContext.requestId} (RP-07)] ReportController.salesByItem() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RP-07)] ReportController.salesByItem() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
