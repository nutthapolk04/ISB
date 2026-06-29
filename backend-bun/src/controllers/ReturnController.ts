/** Returns — list, create, refund, exchange, receipt search (auth: admin | manager | cashier) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";
import { hasRole } from "@/middleware/AuthMiddleware";
import {
	listReturns,
	getReturnsByReceipt,
	getReturn,
	getReturnHistory,
	createReturn,
	createReturnWithoutReceipt,
	updateReturn,
	deleteReturn,
	processRefund,
	processExchange,
	searchReceipts,
	getExchangeProducts,
} from "@/services/returns_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";
import { logger } from "@/logger";

type ReturnUser = AccessTokenPayload & { shop_id?: string | null };

const RETURN_ROLES = ["admin", "manager", "cashier"] as const;

function shopScope(user: ReturnUser): string | null {
	return hasRole(user.roles, "admin") || user.is_superuser ? null : user.shop_id ?? null;
}

export const ReturnController = {
	list: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (RT-01)] ReturnController.list() called.`);
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RT-01)] ReturnController.list() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (RT-01)] ReturnController.list() calling listReturns().`);
			const result = await listReturns({
				q: query.filter ?? undefined,
				shopId: shopScope(user as ReturnUser),
			});
			logger.info(`[${reqContext.requestId} (RT-01)] ReturnController.list() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RT-01)] ReturnController.list() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	byReceipt: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (RT-02)] ReturnController.byReceipt() called.`);
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RT-02)] ReturnController.byReceipt() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (RT-02)] ReturnController.byReceipt() calling getReturnsByReceipt().`);
			const result = await getReturnsByReceipt(query.receiptId, shopScope(user as ReturnUser));
			logger.info(`[${reqContext.requestId} (RT-02)] ReturnController.byReceipt() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RT-02)] ReturnController.byReceipt() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getById: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (RT-03)] ReturnController.getById() called.`);
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RT-03)] ReturnController.getById() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "return id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (RT-03)] ReturnController.getById() invalid return id.`);
			return errorResponse(reqContext, "Invalid return id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (RT-03)] ReturnController.getById() calling getReturn().`);
			const result = await getReturn(id);
			logger.info(`[${reqContext.requestId} (RT-03)] ReturnController.getById() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RT-03)] ReturnController.getById() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	history: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (RT-04)] ReturnController.history() called.`);
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RT-04)] ReturnController.history() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (RT-04)] ReturnController.history() calling getReturnHistory().`);
			const result = await getReturnHistory({
				q: query.filter ?? undefined,
				shopId: shopScope(user as ReturnUser),
			});
			logger.info(`[${reqContext.requestId} (RT-04)] ReturnController.history() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RT-04)] ReturnController.history() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (RT-05)] ReturnController.create() called.`);
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RT-05)] ReturnController.create() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (RT-05)] ReturnController.create() calling createReturn().`);
			const result = await createReturn({
				receiptId: body.receiptId,
				items: body.items as Parameters<typeof createReturn>[0]["items"],
				reason: body.reason,
				userId: Number(user.sub),
			});
			logger.info(`[${reqContext.requestId} (RT-05)] ReturnController.create() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RT-05)] ReturnController.create() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	createWithoutReceipt: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (RT-06)] ReturnController.createWithoutReceipt() called.`);
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RT-06)] ReturnController.createWithoutReceipt() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (RT-06)] ReturnController.createWithoutReceipt() calling createReturnWithoutReceipt().`);
			const result = await createReturnWithoutReceipt({
				items: body.items as Parameters<typeof createReturnWithoutReceipt>[0]["items"],
				reason: body.reason,
				customerName: body.customerName ?? null,
				notes: body.notes ?? null,
				userId: Number(user.sub),
			});
			logger.info(`[${reqContext.requestId} (RT-06)] ReturnController.createWithoutReceipt() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RT-06)] ReturnController.createWithoutReceipt() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	update: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (RT-07)] ReturnController.update() called.`);
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RT-07)] ReturnController.update() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "return id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (RT-07)] ReturnController.update() invalid return id.`);
			return errorResponse(reqContext, "Invalid return id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (RT-07)] ReturnController.update() calling updateReturn().`);
			const result = await updateReturn(id, body);
			logger.info(`[${reqContext.requestId} (RT-07)] ReturnController.update() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RT-07)] ReturnController.update() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	remove: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (RT-08)] ReturnController.remove() called.`);
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RT-08)] ReturnController.remove() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "return id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (RT-08)] ReturnController.remove() invalid return id.`);
			return errorResponse(reqContext, "Invalid return id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (RT-08)] ReturnController.remove() calling deleteReturn().`);
			await deleteReturn(id);
			logger.info(`[${reqContext.requestId} (RT-08)] ReturnController.remove() completed.`);
			return successResponse(reqContext, { success: true }, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RT-08)] ReturnController.remove() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	refund: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (RT-09)] ReturnController.refund() called.`);
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RT-09)] ReturnController.refund() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "return id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (RT-09)] ReturnController.refund() invalid return id.`);
			return errorResponse(reqContext, "Invalid return id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (RT-09)] ReturnController.refund() calling processRefund().`);
			const result = await processRefund({
				returnId: id,
				reason: body.reason,
				notes: body.notes ?? null,
				userId: Number(user.sub),
			});
			logger.info(`[${reqContext.requestId} (RT-09)] ReturnController.refund() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RT-09)] ReturnController.refund() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	exchange: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (RT-10)] ReturnController.exchange() called.`);
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RT-10)] ReturnController.exchange() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "return id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (RT-10)] ReturnController.exchange() invalid return id.`);
			return errorResponse(reqContext, "Invalid return id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (RT-10)] ReturnController.exchange() calling processExchange().`);
			const result = await processExchange({
				returnId: id,
				exchangeItems: body.exchangeItems as Parameters<typeof processExchange>[0]["exchangeItems"],
				reason: body.reason,
				notes: body.notes ?? null,
				userId: Number(user.sub),
			});
			logger.info(`[${reqContext.requestId} (RT-10)] ReturnController.exchange() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RT-10)] ReturnController.exchange() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	searchReceipts: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (RT-11)] ReturnController.searchReceipts() called.`);
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RT-11)] ReturnController.searchReceipts() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		if (!query.receiptId && !query.studentCode && !query.dateFrom && !query.dateTo && !query.paymentMethod) {
			logger.warn(`[${reqContext.requestId} (RT-11)] ReturnController.searchReceipts() missing search criteria.`);
			return errorResponse(reqContext, "At least one search criterion is required", ResponseStatus.BAD_REQUEST);
		}
		try {
			logger.info(`[${reqContext.requestId} (RT-11)] ReturnController.searchReceipts() calling searchReceipts().`);
			const results = await searchReceipts({
				receiptId: query.receiptId ?? null,
				studentCode: query.studentCode ?? null,
				dateFrom: query.dateFrom ?? null,
				dateTo: query.dateTo ?? null,
				paymentMethod: query.paymentMethod ?? null,
				shopId: shopScope(user as ReturnUser),
			});
			if (results.length === 0) {
				logger.warn(`[${reqContext.requestId} (RT-11)] ReturnController.searchReceipts() receipt not found.`);
				return errorResponse(reqContext, "Receipt not found", ResponseStatus.NOT_FOUND);
			}
			logger.info(`[${reqContext.requestId} (RT-11)] ReturnController.searchReceipts() completed.`);
			return successResponse(
				reqContext,
				{
					receipts: results,
					receipt: results.length === 1 ? results[0] : null,
				},
				ResponseStatus.OK,
			);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RT-11)] ReturnController.searchReceipts() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	exchangeProducts: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (RT-12)] ReturnController.exchangeProducts() called.`);
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RT-12)] ReturnController.exchangeProducts() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (RT-12)] ReturnController.exchangeProducts() calling getExchangeProducts().`);
			const result = await getExchangeProducts({
				shopId: query.shop_id ?? null,
				inStock: query.inStock !== "false",
			});
			logger.info(`[${reqContext.requestId} (RT-12)] ReturnController.exchangeProducts() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RT-12)] ReturnController.exchangeProducts() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
