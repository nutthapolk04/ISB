/** BAY payment webhook — POST /api/v1/bay/callback (public; x-pymt-signature when secret set) */
import { publicCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { logger } from "@/logger";
import { timingSafeEqual } from "@/lib/crypto";
import { handleBayCallback } from "@/services/topup_service";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

function verifyWebhookSignature(
	body: unknown,
	provided: string,
	secret: string,
): boolean {
	const raw = JSON.stringify(body);
	const hasher = new Bun.CryptoHasher("sha256", secret);
	hasher.update(raw);
	const expectedHex = hasher.digest("hex");
	const expected = `sha256=${expectedHex}`;
	return timingSafeEqual(expected, provided);
}

// PYMT/BAY's webhook contract (docs/contracts/bay-pymt-contract.md §C) only
// ever sends { transactionNo|orderRef, reference1, reference2, amount,
// status } — no gateway-side event timestamp. These extra field names are
// checked defensively in case a future gateway revision adds one; today
// they will always be absent and gatewayDelayMs will log as null. The only
// BAY-side timestamp anywhere in this codebase is `paymentAt` on the
// *inquiry* response (pymt_gateway.ts), which we don't call on the webhook
// happy path.
const POSSIBLE_GATEWAY_TS_FIELDS = [
	"paymentAt", "paidAt", "transDate", "transactionDate",
	"dateTime", "timestamp", "createdDate", "eventTime", "transTime",
] as const;

function extractGatewayTimestampMs(body: unknown): { field: string; ms: number } | null {
	if (!body || typeof body !== "object") return null;
	const obj = body as Record<string, unknown>;
	for (const field of POSSIBLE_GATEWAY_TS_FIELDS) {
		const v = obj[field];
		if (typeof v === "string" && v.trim()) {
			const ms = Date.parse(v);
			if (Number.isFinite(ms)) return { field, ms };
		}
	}
	return null;
}

export const BayCallbackController = {
	callback: async (ctx: any) => {
		// Capture arrival time before anything else (signature check, JSON
		// parsing already done by Elysia) so the timing log reflects true
		// "webhook hit our process" latency, not work we did afterwards.
		const t0 = performance.now();
		const receivedAtIso = new Date().toISOString();

		const reqContext = publicCtx(ctx);
		const { body, request } = reqContext;
		logger.info(`[${reqContext.requestId} (BC-01)] BayCallbackController.callback() called.`);
		const secret = process.env.PYMT_WEBHOOK_SECRET ?? "";
		if (secret) {
			const provided = request.headers.get("x-pymt-signature") ?? "";
			if (!provided) {
				logger.warn(`[${reqContext.requestId} (BC-01)] BayCallbackController.callback() missing signature.`);
				return errorResponse(reqContext, "Missing X-PYMT-Signature header", ResponseStatus.UNAUTHORIZED);
			}
			if (!verifyWebhookSignature(body, provided, secret)) {
				logger.warn(`[${reqContext.requestId} (BC-01)] BayCallbackController.callback() invalid signature.`);
				return errorResponse(reqContext, "Invalid signature", ResponseStatus.UNAUTHORIZED);
			}
		} else {
			logger.warn(`[${reqContext.requestId} (BC-01)] BayCallbackController.callback() PYMT_WEBHOOK_SECRET not set — accepting unsigned webhook (dev only).`);
		}

		const bodyObj = (body ?? {}) as Record<string, unknown>;
		const refHint = (bodyObj.orderRef ?? bodyObj.reference1 ?? bodyObj.transactionNo ?? null) as string | null;
		const gatewayTs = extractGatewayTimestampMs(body);

		try {
			logger.info(`[${reqContext.requestId} (BC-01)] BayCallbackController.callback() calling handleBayCallback().`);
			const result = await handleBayCallback(body);
			const totalHandlerMs = performance.now() - t0;
			logger.info("[BAY callback] timing", {
				requestId: reqContext.requestId,
				refHint,
				status: bodyObj.status ?? null,
				receivedAtIso,
				gatewayTimestampField: gatewayTs?.field ?? null,
				gatewayDelayMs: gatewayTs ? Math.round(Date.now() - gatewayTs.ms) : null,
				totalHandlerMs: Math.round(totalHandlerMs),
			});
			logger.info(`[${reqContext.requestId} (BC-01)] BayCallbackController.callback() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			const totalHandlerMs = performance.now() - t0;
			logger.info("[BAY callback] timing", {
				requestId: reqContext.requestId,
				refHint,
				status: bodyObj.status ?? null,
				receivedAtIso,
				gatewayTimestampField: gatewayTs?.field ?? null,
				gatewayDelayMs: gatewayTs ? Math.round(Date.now() - gatewayTs.ms) : null,
				totalHandlerMs: Math.round(totalHandlerMs),
				failed: true,
			});
			logger.error(`[${reqContext.requestId} (BC-01)] BayCallbackController.callback() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
