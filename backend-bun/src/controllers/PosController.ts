/** POS — receipts, checkout, void, QR payment intents (auth: cashier | manager | admin | kiosk) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";
import { hasRole } from "@/middleware/AuthMiddleware";
import { listReceipts, getReceipt, voidReceipt } from "@/services/pos_service";
import {
	listTransactions,
	getTransactionDetail,
	markTransactionCancelledByRefCode,
	startEdcAttempt,
	type StartTransactionInput,
} from "@/services/pos_transaction_service";
import { checkout, type CheckoutInput } from "@/services/pos_checkout_service";
import {
	createPosQrIntent,
	getPosQrIntent,
	cancelPosQrIntent,
	confirmPosQrSale,
} from "@/services/pos_qr_service";
import {
	recordEdcEvent,
	listEdcEvents,
	type RecordEdcEventInput,
} from "@/services/edc_telemetry_service";
import { recordFailedCheckout, listFailedCheckouts } from "@/services/failed_checkout_service";
import { scopeShop } from "@/services/report_service";
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
				payerQ: query.payer_q ?? undefined,
				paymentMethod: query.payment_method ?? undefined,
				shopId: query.shop_id ?? undefined,
				shopIds: query.shop_ids ?? undefined,
				transactionMode: query.transaction_mode ?? undefined,
				requesterUserId: query.requester_user_id ? Number(query.requester_user_id) : undefined,
				dateFrom: query.date_from ?? undefined,
				dateTo: query.date_to ?? undefined,
				page: query.page ? Number(query.page) : undefined,
				pageSize: query.page_size ? Number(query.page_size) : undefined,
				includeStats: query.include_stats === "1" || query.include_stats === "true",
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

	listTransactions: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-11)] PosController.listTransactions() called.`);
		try {
			logger.info(`[${reqContext.requestId} (PC-11)] PosController.listTransactions() calling listTransactions().`);
			const result = await listTransactions({
				caller: user as PosUser,
				status: query.status ?? undefined,
				paymentMethod: query.payment_method ?? undefined,
				shopId: query.shop_id ?? undefined,
				shopIds: query.shop_ids ?? undefined,
				dateFrom: query.date_from ?? undefined,
				dateTo: query.date_to ?? undefined,
				page: query.page ? Number(query.page) : undefined,
				pageSize: query.page_size ? Number(query.page_size) : undefined,
			});
			logger.info(`[${reqContext.requestId} (PC-11)] PosController.listTransactions() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PC-11)] PosController.listTransactions() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getTransaction: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-13)] PosController.getTransaction() called.`);
		const id = parseIntParam(params.id, "transaction id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (PC-13)] PosController.getTransaction() invalid id.`);
			return errorResponse(reqContext, "Invalid transaction id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (PC-13)] PosController.getTransaction() calling getTransactionDetail().`);
			const result = await getTransactionDetail(id, user as PosUser);
			logger.info(`[${reqContext.requestId} (PC-13)] PosController.getTransaction() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PC-13)] PosController.getTransaction() error:`, e);
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
			const { edc_pending_ref, ...checkoutBody } = body as Omit<CheckoutInput, "userId"> & {
				edc_pending_ref?: string | null;
			};
			const result = await checkout(
				{ ...checkoutBody, userId: Number(user.sub) },
				edc_pending_ref ? { linkToTransactionRefCode: edc_pending_ref } : undefined,
			);
			logger.info(`[${reqContext.requestId} (PC-03)] PosController.checkout() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PC-03)] PosController.checkout() error:`, e);
			// Keep the cart. Without this a rejected sale leaves only a log line
			// and nobody can say afterwards what the customer was buying.
			// Fire-and-forget and self-swallowing: the cashier's error must not
			// wait on it, and a logging fault must not replace the real message.
			const status = ((e as { status?: number }).status ?? 500) >= 500 ? "error" : "rejected";
			void recordFailedCheckout({
				status,
				body: body as Record<string, unknown>,
				cashierUserId: Number(user.sub) || null,
				errorCode: (e as { code?: string }).code ?? null,
				errorMessage: e instanceof Error ? e.message : String(e),
				requestId: String(reqContext.requestId ?? ""),
			});
			return errorFromService(reqContext, e);
		}
	},

	/**
	 * Client-side report that a checkout request never completed (network drop
	 * or timeout).
	 *
	 * Not a failure claim — the service resolves the idempotency key against
	 * `receipts` first and drops the report if the sale actually landed. Always
	 * answers 200 so a best-effort caller never retries into a loop.
	 */
	reportFailedCheckout: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-11)] PosController.reportFailedCheckout() called.`);
		if (!hasRole(user.roles, ...POS_ROLES)) {
			logger.warn(`[${reqContext.requestId} (PC-11)] PosController.reportFailedCheckout() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const result = await recordFailedCheckout({
			status: "not_recorded",
			body: (body as { payload?: Record<string, unknown> })?.payload ?? {},
			cashierUserId: Number(user.sub) || null,
			errorMessage: (body as { client_error?: string })?.client_error ?? null,
			requestId: String(reqContext.requestId ?? ""),
		});
		logger.info(`[${reqContext.requestId} (PC-11)] PosController.reportFailedCheckout() completed.`);
		return successResponse(reqContext, result, ResponseStatus.OK);
	},

	listFailedCheckouts: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-12)] PosController.listFailedCheckouts() called.`);
		// Same gate as the EDC event log: carts and payer ids, not a POS feature.
		if (!hasRole(user.roles, "manager", "admin")) {
			logger.warn(`[${reqContext.requestId} (PC-12)] PosController.listFailedCheckouts() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			const scopedShopId = scopeShop(user, query.shop_id ?? null);
			const result = await listFailedCheckouts({
				shopId: scopedShopId ?? undefined,
				dateFrom: query.date_from ?? undefined,
				dateToExclusive: query.date_to ?? undefined,
				limit: query.limit ? Number(query.limit) : undefined,
			});
			logger.info(`[${reqContext.requestId} (PC-12)] PosController.listFailedCheckouts() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PC-12)] PosController.listFailedCheckouts() error:`, e);
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
			logger.info(`[${reqContext.requestId} (PC-05)] PosController.createQrIntent() body.cart:`, {
				shop_id: body.cart?.shop_id,
				keys: Object.keys(body.cart ?? {}),
			});
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

	/**
	 * Cashier gave up on this QR screen (Cancel / Skip for now / Back).
	 * Marks only the Transactions-tab row cancelled — the payment_intent
	 * itself is left untouched (still 'pending') so a late webhook can still
	 * complete the sale; if it does, checkout()'s markTransactionSuccess call
	 * flips this same row back to 'success' automatically. Best-effort: a
	 * logging miss here must never surface as an error to the cashier.
	 */
	abandonQrIntent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-12)] PosController.abandonQrIntent() called.`);
		if (!hasRole(user.roles, ...POS_ROLES)) {
			logger.warn(`[${reqContext.requestId} (PC-12)] PosController.abandonQrIntent() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		await markTransactionCancelledByRefCode(params.refCode);
		logger.info(`[${reqContext.requestId} (PC-12)] PosController.abandonQrIntent() completed.`);
		return successResponse(reqContext, { ok: true }, ResponseStatus.OK);
	},

	/**
	 * Log a pending Transactions-tab row the instant the cashier picks EDC —
	 * before the terminal has replied. Without this, an attempt where the
	 * bridge never answers (terminal offline, "Failed to fetch") leaves zero
	 * trace in the Transactions tab, since checkout() is only ever called
	 * after the terminal returns an approval code. Never fails the request:
	 * startEdcAttempt swallows its own logging errors and returns a null
	 * ref_code, and the frontend just skips linking in that case.
	 */
	startEdcAttempt: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-14)] PosController.startEdcAttempt() called.`);
		if (!hasRole(user.roles, ...POS_ROLES)) {
			logger.warn(`[${reqContext.requestId} (PC-14)] PosController.startEdcAttempt() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const cart = body.cart as {
			transaction_mode?: string | null;
			shop_id?: string | null;
			payer_kind?: string | null;
			customer_id?: number | null;
			payer_user_id?: number | null;
			payer_department_id?: number | null;
			items: unknown[];
		};
		const result = await startEdcAttempt({
			refCode: body.ref_code,
			transactionMode: cart.transaction_mode ?? null,
			shopId: cart.shop_id ?? null,
			cashierUserId: Number(user.sub),
			payerKind: cart.payer_kind ?? null,
			payerId: cart.customer_id ?? cart.payer_user_id ?? cart.payer_department_id ?? null,
			itemsCount: cart.items.length,
			amount: body.amount,
			items: cart.items as StartTransactionInput["items"],
		});
		logger.info(`[${reqContext.requestId} (PC-14)] PosController.startEdcAttempt() completed.`);
		return successResponse(reqContext, result, ResponseStatus.OK);
	},

	/**
	 * Cashier backed out of the EDC modal (Back / closed) before the terminal
	 * ever answered. Marks only the Transactions-tab row cancelled — mirrors
	 * abandonQrIntent above.
	 */
	abandonEdcAttempt: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-15)] PosController.abandonEdcAttempt() called.`);
		if (!hasRole(user.roles, ...POS_ROLES)) {
			logger.warn(`[${reqContext.requestId} (PC-15)] PosController.abandonEdcAttempt() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		await markTransactionCancelledByRefCode(params.refCode);
		logger.info(`[${reqContext.requestId} (PC-15)] PosController.abandonEdcAttempt() completed.`);
		return successResponse(reqContext, { ok: true }, ResponseStatus.OK);
	},

	/**
	 * Append one EDC bridge event (terminal result or bridge error).
	 *
	 * Best-effort telemetry called by the cashier's browser, so it is
	 * deliberately forgiving: it never 4xx/5xx's on bad content, because the
	 * caller fires and forgets and an error here would be silently dropped
	 * anyway. Malformed payloads are logged and acknowledged rather than
	 * rejected — losing a row is worse than storing an imperfect one, since
	 * the whole point is to have *something* to read after an incident.
	 */
	recordEdcEvent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-09)] PosController.recordEdcEvent() called.`);
		if (!hasRole(user.roles, ...POS_ROLES)) {
			logger.warn(`[${reqContext.requestId} (PC-09)] PosController.recordEdcEvent() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			const result = await recordEdcEvent({
				...(body as Omit<RecordEdcEventInput, "cashierUserId">),
				// Never trust a cashier id from the body.
				cashierUserId: Number(user.sub) || null,
			});
			logger.info(`[${reqContext.requestId} (PC-09)] PosController.recordEdcEvent() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			// Swallow: telemetry must never surface as an error to the POS.
			logger.error(`[${reqContext.requestId} (PC-09)] PosController.recordEdcEvent() error:`, e);
			return successResponse(reqContext, { id: null }, ResponseStatus.OK);
		}
	},

	listEdcEvents: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (PC-10)] PosController.listEdcEvents() called.`);
		// Reading raw terminal traffic is an investigation tool, not a POS
		// feature — managers and admins only, never plain cashiers or kiosks.
		if (!hasRole(user.roles, "manager", "admin")) {
			logger.warn(`[${reqContext.requestId} (PC-10)] PosController.listEdcEvents() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			// Scope to the caller's own shop. Without this a manager could read
			// another shop's carts and masked cards just by changing shop_id —
			// or omit it entirely and get every shop. admin/finance still see
			// across shops, matching every other report.
			const scopedShopId = scopeShop(user, query.shop_id ?? null);
			const result = await listEdcEvents({
				dateFrom: query.date_from ?? undefined,
				dateToExclusive: query.date_to ?? undefined,
				shopId: scopedShopId ?? undefined,
				unrecordedOnly: query.unrecorded_only === "true",
				limit: query.limit ? Number(query.limit) : undefined,
			});
			logger.info(`[${reqContext.requestId} (PC-10)] PosController.listEdcEvents() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (PC-10)] PosController.listEdcEvents() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
