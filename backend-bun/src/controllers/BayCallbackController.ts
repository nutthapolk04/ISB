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

export const BayCallbackController = {
	callback: async (ctx: any) => {
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
		try {
			logger.info(`[${reqContext.requestId} (BC-01)] BayCallbackController.callback() calling handleBayCallback().`);
			const result = await handleBayCallback(body);
			logger.info(`[${reqContext.requestId} (BC-01)] BayCallbackController.callback() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (BC-01)] BayCallbackController.callback() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
