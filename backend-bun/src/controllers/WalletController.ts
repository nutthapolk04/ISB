/** Wallets — me, family, transactions, adjust, transfer (auth) */
import type { Context } from "elysia";
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

type WalletUser = AccessTokenPayload & { shop_id?: string | null; family_code?: string | null };

export const WalletController = {
	me: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		try {
			return successResponse(reqContext, await getMyWallet(user), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	family: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		if (!hasRole(user.roles, "parent", "staff", "cashier", "manager", "kitchen", "admin", "student")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(reqContext, await listFamilyWallets(user), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	getById: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		const id = parseIntParam(params.id, "wallet id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid wallet id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await getWallet(user as WalletUser, id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	transactions: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, query } = reqContext;
		const id = parseIntParam(params.id, "wallet id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid wallet id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await listTransactions(
					user as WalletUser,
					id,
					query.date_from ?? undefined,
					query.date_to ?? undefined,
				),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	adjust: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "wallet id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid wallet id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await adjustBalance({
					walletId: id,
					amount: body.amount,
					adminUserId: Number(user.sub),
					reason: body.reason,
					referenceTicket: body.reference_ticket ?? undefined,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	transfer: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		try {
			return successResponse(
				reqContext,
				await transferWithinFamily({
					fromWalletId: body.from_wallet_id,
					toWalletId: body.to_wallet_id,
					amount: body.amount,
					initiatorUserId: Number(user.sub),
					initiatorIsAdmin: hasRole(user.roles, "admin") || user.is_superuser,
					initiatorRoles: user.roles,
					note: body.note ?? undefined,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
