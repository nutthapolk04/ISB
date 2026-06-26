/** BAY payment webhook — POST /api/v1/bay/callback (public; x-pymt-signature when secret set) */
import { publicCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { logger } from "@/logger";
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
	const a = new TextEncoder().encode(expected);
	const b = new TextEncoder().encode(provided);
	let diff = a.length ^ b.length;
	for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

export const BayCallbackController = {
	callback: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const { body, request } = reqContext;
		const secret = process.env.PYMT_WEBHOOK_SECRET ?? "";
		if (secret) {
			const provided = request.headers.get("x-pymt-signature") ?? "";
			if (!provided) {
				return errorResponse(reqContext, "Missing X-PYMT-Signature header", ResponseStatus.UNAUTHORIZED);
			}
			if (!verifyWebhookSignature(body, provided, secret)) {
				return errorResponse(reqContext, "Invalid signature", ResponseStatus.UNAUTHORIZED);
			}
		} else {
			logger.warn("[bay/callback] PYMT_WEBHOOK_SECRET not set — accepting unsigned webhook (dev only)");
		}
		try {
			return successResponse(reqContext, await handleBayCallback(body), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
