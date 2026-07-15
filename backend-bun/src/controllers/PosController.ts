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
import { logger } from "@/logger";

type PosUser = AccessTokenPayload & { shop_id?: string | null };

const POS_ROLES = ["cashier", "manager", "admin", "kiosk"] as const;

export const PosController = {
	listReceipts: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-01)] PosController.listReceipts() called.`);
		try {
			logger.info(`[${reqContext.requestId} (PC-01)] PosController.listReceipts() calling listReceipts().`);
			const result = await listReceipts({
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
			});
			logger.info(`[${reqContext.requestId} (PC-01)] PosController.listReceipts() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PC-01)] PosController.listReceipts() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getReceipt: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-02)] PosController.getReceipt() called.`);
		const id = parseIntParam(params.id, "receipt id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (PC-02)] PosController.getReceipt() invalid receipt id.`);
			return errorResponse(reqContext, "Invalid receipt id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (PC-02)] PosController.getReceipt() calling getReceipt().`);
			const result = await getReceipt(id);
			logger.info(`[${reqContext.requestId} (PC-02)] PosController.getReceipt() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PC-02)] PosController.getReceipt() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	checkout: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-03)] PosController.checkout() called.`);
		if (!hasRole(user.roles, ...POS_ROLES)) {
			logger.warn(`[${reqContext.requestId} (PC-03)] PosController.checkout() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (PC-03)] PosController.checkout() calling checkout().`);
			const result = await checkout({ ...(body as Omit<CheckoutInput, "userId">), userId: Number(user.sub) });
			logger.info(`[${reqContext.requestId} (PC-03)] PosController.checkout() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PC-03)] PosController.checkout() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	voidReceipt: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-04)] PosController.voidReceipt() called.`);
		if (!hasRole(user.roles, "admin", "manager", "cashier")) {
			logger.warn(`[${reqContext.requestId} (PC-04)] PosController.voidReceipt() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "receipt id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (PC-04)] PosController.voidReceipt() invalid receipt id.`);
			return errorResponse(reqContext, "Invalid receipt id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (PC-04)] PosController.voidReceipt() calling voidReceipt().`);
			const result = await voidReceipt({
				caller: user as PosUser,
				receiptId: id,
				reason: body?.reason ?? null,
			});
			logger.info(`[${reqContext.requestId} (PC-04)] PosController.voidReceipt() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PC-04)] PosController.voidReceipt() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	createQrIntent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-05)] PosController.createQrIntent() called.`);
		if (!hasRole(user.roles, ...POS_ROLES)) {
			logger.warn(`[${reqContext.requestId} (PC-05)] PosController.createQrIntent() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (PC-05)] PosController.createQrIntent() calling createPosQrIntent().`);
			const result = await createPosQrIntent({
				cart: { ...(body.cart as Omit<CheckoutInput, "payment_method">), userId: Number(user.sub) },
				cashierUserId: Number(user.sub),
				amount: body.amount,
			});
			logger.info(`[${reqContext.requestId} (PC-05)] PosController.createQrIntent() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PC-05)] PosController.createQrIntent() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	// This is the endpoint the cashier's QrPaymentModal polls every ~2s while
	// waiting for payment (see frontend QrPaymentModal.tsx POLL_INTERVAL_MS).
	// Timed so we can see, once deployed, whether poll latency itself is
	// ever a meaningful contributor to the "QR callback ช้ามาก" complaint —
	// expected to be a few ms (single indexed SELECT by ref_code) and NOT
	// the bottleneck, but measure rather than assume.
	getQrIntentStatus: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		const t0 = performance.now();
		logger.info(`[${reqContext.requestId} (PC-06)] PosController.getQrIntentStatus() called.`);
		if (!hasRole(user.roles, ...POS_ROLES)) {
			logger.warn(`[${reqContext.requestId} (PC-06)] PosController.getQrIntentStatus() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (PC-06)] PosController.getQrIntentStatus() calling getPosQrIntent().`);
			const result = await getPosQrIntent(params.refCode);
			logger.info("[POS QR] status-poll timing", {
				refCode: params.refCode,
				status: result.status,
				durationMs: Math.round(performance.now() - t0),
			});
			logger.info(`[${reqContext.requestId} (PC-06)] PosController.getQrIntentStatus() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PC-06)] PosController.getQrIntentStatus() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	inquireQrIntent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-07)] PosController.inquireQrIntent() called.`);
		if (!hasRole(user.roles, ...POS_ROLES)) {
			logger.warn(`[${reqContext.requestId} (PC-07)] PosController.inquireQrIntent() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (PC-07)] PosController.inquireQrIntent() calling getPosQrIntent().`);
			const local = await getPosQrIntent(params.refCode);
			if (local.status !== "pending" || !local.txn_no) {
				logger.info(`[${reqContext.requestId} (PC-07)] PosController.inquireQrIntent() completed.`);
				return successResponse(reqContext, local, ResponseStatus.OK);
			}
			logger.info(`[${reqContext.requestId} (PC-07)] PosController.inquireQrIntent() calling bayQrInquiry().`);
			const inq = await bayQrInquiry({ transactionNo: local.txn_no });
			if (inq.status === "confirmed") {
				await confirmPosQrSale(params.refCode);
			} else if (inq.status === "cancelled") {
				await cancelPosQrIntent(params.refCode);
			}
			const result = await getPosQrIntent(params.refCode);
			logger.info(`[${reqContext.requestId} (PC-07)] PosController.inquireQrIntent() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PC-07)] PosController.inquireQrIntent() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	cancelQrIntent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-08)] PosController.cancelQrIntent() called.`);
		if (!hasRole(user.roles, ...POS_ROLES)) {
			logger.warn(`[${reqContext.requestId} (PC-08)] PosController.cancelQrIntent() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (PC-08)] PosController.cancelQrIntent() calling cancelPosQrIntent().`);
			await cancelPosQrIntent(params.refCode);
			const result = await getPosQrIntent(params.refCode);
			logger.info(`[${reqContext.requestId} (PC-08)] PosController.cancelQrIntent() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PC-08)] PosController.cancelQrIntent() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
