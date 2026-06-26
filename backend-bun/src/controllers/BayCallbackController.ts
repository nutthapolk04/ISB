import type { HandlerContext } from "@/controllers/types";
import { handleBayCallback } from "@/services/topup_service";
import { handleServiceError } from "@/utils/ResponseUtil";

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
        const { body, request, set } = ctx;
        const secret = process.env.PYMT_WEBHOOK_SECRET ?? "";
        if (secret) {
            const provided = request.headers.get("x-pymt-signature") ?? "";
            if (!provided) {
                set.status = 401;
                return { detail: "Missing X-PYMT-Signature header" };
            }
            if (!verifyWebhookSignature(body, provided, secret)) {
                set.status = 401;
                return { detail: "Invalid signature" };
            }
        } else {
            console.warn("[bay/callback] PYMT_WEBHOOK_SECRET not set — accepting unsigned webhook (dev only)");
        }
        try {
            return await handleBayCallback(body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
