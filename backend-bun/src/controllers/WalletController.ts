/** Wallets — me, family, transactions, adjust, transfer (auth) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";
import { hasRole } from "@/middleware/AuthMiddleware";
import {
	getMyWallet,
	listFamilyWallets,
	getWallet,
	listTransactions,
	adjustBalance,
	transferWithinFamily,
} from "@/services/wallet_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";
import { logger } from "@/logger";

type WalletUser = AccessTokenPayload & { shop_id?: string | null; family_code?: string | null };

export const WalletController = {
	me: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		logger.info(`[${reqContext.requestId} (WL-01)] WalletController.me() called.`);
		try {
			logger.info(`[${reqContext.requestId} (WL-01)] WalletController.me() calling getMyWallet().`);
			const result = await getMyWallet(user);
			logger.info(`[${reqContext.requestId} (WL-01)] WalletController.me() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (WL-01)] WalletController.me() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	family: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		logger.info(`[${reqContext.requestId} (WL-02)] WalletController.family() called.`);
		if (!hasRole(user.roles, "parent", "staff", "cashier", "manager", "kitchen", "admin", "student")) {
			logger.warn(`[${reqContext.requestId} (WL-02)] WalletController.family() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (WL-02)] WalletController.family() calling listFamilyWallets().`);
			const result = await listFamilyWallets(user);
			logger.info(`[${reqContext.requestId} (WL-02)] WalletController.family() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (WL-02)] WalletController.family() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getById: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (WL-03)] WalletController.getById() called.`);
		const id = parseIntParam(params.id, "wallet id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (WL-03)] WalletController.getById() invalid wallet id.`);
			return errorResponse(reqContext, "Invalid wallet id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (WL-03)] WalletController.getById() calling getWallet().`);
			const result = await getWallet(user as WalletUser, id);
			logger.info(`[${reqContext.requestId} (WL-03)] WalletController.getById() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (WL-03)] WalletController.getById() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	transactions: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, query } = reqContext;
		logger.info(`[${reqContext.requestId} (WL-04)] WalletController.transactions() called.`);
		const id = parseIntParam(params.id, "wallet id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (WL-04)] WalletController.transactions() invalid wallet id.`);
			return errorResponse(reqContext, "Invalid wallet id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (WL-04)] WalletController.transactions() calling listTransactions().`);
			const result = await listTransactions(
				user as WalletUser,
				id,
				query.date_from ?? undefined,
				query.date_to ?? undefined,
			);
			logger.info(`[${reqContext.requestId} (WL-04)] WalletController.transactions() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (WL-04)] WalletController.transactions() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	adjust: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (WL-05)] WalletController.adjust() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (WL-05)] WalletController.adjust() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "wallet id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (WL-05)] WalletController.adjust() invalid wallet id.`);
			return errorResponse(reqContext, "Invalid wallet id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (WL-05)] WalletController.adjust() calling adjustBalance().`);
			const result = await adjustBalance({
				walletId: id,
				amount: body.amount,
				adminUserId: Number(user.sub),
				reason: body.reason,
				referenceTicket: body.reference_ticket ?? undefined,
			});
			logger.info(`[${reqContext.requestId} (WL-05)] WalletController.adjust() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (WL-05)] WalletController.adjust() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	transfer: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (WL-06)] WalletController.transfer() called.`);
		try {
			logger.info(`[${reqContext.requestId} (WL-06)] WalletController.transfer() calling transferWithinFamily().`);
			const result = await transferWithinFamily({
				fromWalletId: body.from_wallet_id,
				toWalletId: body.to_wallet_id,
				amount: body.amount,
				initiatorUserId: Number(user.sub),
				initiatorIsAdmin: hasRole(user.roles, "admin") || user.is_superuser,
				initiatorRoles: user.roles,
				note: body.note,
			});
			logger.info(`[${reqContext.requestId} (WL-06)] WalletController.transfer() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (WL-06)] WalletController.transfer() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
