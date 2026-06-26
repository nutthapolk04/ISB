/** POS — receipts, checkout, void, QR payment intents (auth: cashier | manager | admin | kiosk) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";
import { hasRole } from "@/middleware/AuthMiddleware";
import { listReceipts, getReceipt, voidReceipt } from "@/services/pos_service";
import { checkout, type CheckoutInput } from "@/services/pos_checkout_service";
import {
	createPosQrIntent,
	getPosQrIntent,
	cancelPosQrIntent,
	confirmPosQrSale,
} from "@/services/pos_qr_service";
import { qrInquiry as bayQrInquiry } from "@/services/pymt_gateway";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

type PosUser = AccessTokenPayload & { shop_id?: string | null };

const POS_ROLES = ["cashier", "manager", "admin", "kiosk"] as const;

export const PosController = {
	listReceipts: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		try {
			return successResponse(
				reqContext,
				await listReceipts({
					caller: user as PosUser,
					q: query.q ?? undefined,
					shopId: query.shop_id ?? undefined,
					shopIds: query.shop_ids ?? undefined,
					transactionMode: query.transaction_mode ?? undefined,
					requesterUserId: query.requester_user_id ? Number(query.requester_user_id) : undefined,
					dateFrom: query.date_from ?? undefined,
					dateTo: query.date_to ?? undefined,
					page: query.page ? Number(query.page) : undefined,
					pageSize: query.page_size ? Number(query.page_size) : undefined,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	getReceipt: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		const id = parseIntParam(params.id, "receipt id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid receipt id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await getReceipt(id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	checkout: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		if (!hasRole(user.roles, ...POS_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await checkout({ ...(body as Omit<CheckoutInput, "userId">), userId: Number(user.sub) }),
				ResponseStatus.OK,
			);
		} catch (e) {
			const err = e as { status?: number; message?: string; code?: string };
			if (err.status && err.status >= 400 && err.status < 600) {
				reqContext.set.status = err.status;
				return err.code
					? { detail: err.message ?? "Bad request", code: err.code }
					: { detail: err.message ?? "Bad request" };
			}
			throw e;
		}
	},

	voidReceipt: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager", "cashier")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "receipt id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid receipt id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await voidReceipt({
					caller: user as PosUser,
					receiptId: id,
					reason: body?.reason ?? null,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	createQrIntent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		if (!hasRole(user.roles, ...POS_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await createPosQrIntent({
					cart: { ...(body.cart as Omit<CheckoutInput, "payment_method">), userId: Number(user.sub) },
					cashierUserId: Number(user.sub),
					amount: body.amount,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	getQrIntentStatus: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, ...POS_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(reqContext, await getPosQrIntent(params.refCode), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	inquireQrIntent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, ...POS_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			const local = await getPosQrIntent(params.refCode);
			if (local.status !== "pending" || !local.txn_no) {
				return successResponse(reqContext, local, ResponseStatus.OK);
			}
			const inq = await bayQrInquiry({ transactionNo: local.txn_no });
			if (inq.status === "confirmed") {
				await confirmPosQrSale(params.refCode);
			} else if (inq.status === "cancelled") {
				await cancelPosQrIntent(params.refCode);
			}
			return successResponse(reqContext, await getPosQrIntent(params.refCode), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	cancelQrIntent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, ...POS_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			await cancelPosQrIntent(params.refCode);
			return successResponse(reqContext, await getPosQrIntent(params.refCode), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
