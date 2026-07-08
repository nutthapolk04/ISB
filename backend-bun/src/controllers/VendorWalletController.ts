/** Vendor wallet-adjust-balance API — public; x-api-key (no JWT). */
import { publicCtx } from "@/interfaces/ServiceRequest";
import { logger } from "@/logger";
import { checkVendorApiKey, vendorAdjustSuccess, vendorAdjustFailed, vendorAdjustSystemError } from "@/lib/vendor_wallet_response";
import { vendorAdjustBalance, VendorAdjustError } from "@/services/wallet_service";

export const VendorWalletController = {
    adjustBalance: async (ctx: any) => {
        const reqContext = publicCtx(ctx);
        const { body, headers } = reqContext;
        const reqEcho = {
            customerId: body.customerId,
            transactionId: body.transactionId,
            amount: body.amount,
            type: body.type,
            source: body.source,
            reasonCode: body.reasonCode,
            description: body.description,
        };
        logger.info(`[${reqContext.requestId} (VW-01)] VendorWalletController.adjustBalance() called.`);
        if (!checkVendorApiKey(headers as Record<string, string | undefined>)) {
            logger.warn(`[${reqContext.requestId} (VW-01)] VendorWalletController.adjustBalance() auth failed.`);
            reqContext.set.status = 401;
            return vendorAdjustFailed(
                reqContext.set,
                reqEcho,
                new VendorAdjustError("INVALID_REQUEST", 401, "Invalid or missing API key (expected header 'x-api-key')."),
            );
        }
        try {
            const result = await vendorAdjustBalance({
                customerId: body.customerId,
                transactionId: body.transactionId,
                amount: body.amount,
                type: body.type,
                source: body.source,
                reasonCode: body.reasonCode,
                description: body.description,
                requestedBy: body.requestedBy,
            });
            logger.info(`[${reqContext.requestId} (VW-01)] VendorWalletController.adjustBalance() completed.`);
            return vendorAdjustSuccess(reqEcho, result);
        } catch (e) {
            if (e instanceof VendorAdjustError) {
                logger.warn(`[${reqContext.requestId} (VW-01)] VendorWalletController.adjustBalance() failed: ${e.code} — ${e.message}`);
                return vendorAdjustFailed(reqContext.set, reqEcho, e);
            }
            logger.error(`[${reqContext.requestId} (VW-01)] VendorWalletController.adjustBalance() error:`, e);
            return vendorAdjustSystemError(reqContext.set, reqEcho, (e as Error).message);
        }
    },
};
