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

type ReturnUser = AccessTokenPayload & { shop_id?: string | null };

const RETURN_ROLES = ["admin", "manager", "cashier"] as const;

function shopScope(user: ReturnUser): string | null {
	return hasRole(user.roles, "admin") || user.is_superuser ? null : user.shop_id ?? null;
}

export const ReturnController = {
	list: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await listReturns({
					q: query.filter ?? undefined,
					shopId: shopScope(user as ReturnUser),
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	byReceipt: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await getReturnsByReceipt(query.receiptId, shopScope(user as ReturnUser)),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	getById: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "return id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid return id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await getReturn(id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	history: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await getReturnHistory({
					q: query.filter ?? undefined,
					shopId: shopScope(user as ReturnUser),
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await createReturn({
					receiptId: body.receiptId,
					items: body.items as Parameters<typeof createReturn>[0]["items"],
					reason: body.reason,
					userId: Number(user.sub),
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	createWithoutReceipt: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await createReturnWithoutReceipt({
					items: body.items as Parameters<typeof createReturnWithoutReceipt>[0]["items"],
					reason: body.reason,
					customerName: body.customerName ?? null,
					notes: body.notes ?? null,
					userId: Number(user.sub),
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	update: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "return id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid return id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await updateReturn(id, body), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	remove: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "return id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid return id", ResponseStatus.UNPROCESSABLE);
		try {
			await deleteReturn(id);
			return successResponse(reqContext, { success: true }, ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	refund: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "return id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid return id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await processRefund({
					returnId: id,
					reason: body.reason,
					notes: body.notes ?? null,
					userId: Number(user.sub),
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	exchange: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "return id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid return id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await processExchange({
					returnId: id,
					exchangeItems: body.exchangeItems as Parameters<typeof processExchange>[0]["exchangeItems"],
					reason: body.reason,
					notes: body.notes ?? null,
					userId: Number(user.sub),
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	searchReceipts: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		if (!query.receiptId && !query.studentCode && !query.dateFrom && !query.dateTo && !query.paymentMethod) {
			return errorResponse(reqContext, "At least one search criterion is required", ResponseStatus.BAD_REQUEST);
		}
		try {
			const results = await searchReceipts({
				receiptId: query.receiptId ?? null,
				studentCode: query.studentCode ?? null,
				dateFrom: query.dateFrom ?? null,
				dateTo: query.dateTo ?? null,
				paymentMethod: query.paymentMethod ?? null,
				shopId: shopScope(user as ReturnUser),
			});
			if (results.length === 0) {
				return errorResponse(reqContext, "Receipt not found", ResponseStatus.NOT_FOUND);
			}
			return successResponse(
				reqContext,
				{
					receipts: results,
					receipt: results.length === 1 ? results[0] : null,
				},
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	exchangeProducts: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		if (!hasRole(user.roles, ...RETURN_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await getExchangeProducts({
					shopId: query.shop_id ?? null,
					inStock: query.inStock !== "false",
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
