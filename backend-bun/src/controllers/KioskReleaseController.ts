/** Kiosk APK releases — public binary from ISB_PHOTO_DIR */
import { publicCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { logger } from "@/logger";
import { readKioskRelease } from "@/services/kiosk_release_service";
import { errorFromService, errorResponse } from "@/utils/ResponseUtil";

export const KioskReleaseController = {
    getBinary: async (ctx: any) => {
        const reqContext = publicCtx(ctx);
        const { params } = reqContext;
        const filename = params.filename;
        logger.info(`[${reqContext.requestId} (KR-01)] KioskReleaseController.getBinary() called.`);
        if (!filename || typeof filename !== "string") {
            return errorResponse(reqContext, "filename is required", ResponseStatus.UNPROCESSABLE);
        }
        try {
            logger.debug(`[${reqContext.requestId} (KR-01)] KioskReleaseController.getBinary() filename: ${filename}`);
            const bin = await readKioskRelease(filename);
            reqContext.set.headers["Content-Type"] = bin.contentType;
            reqContext.set.headers["Content-Disposition"] = `attachment; filename="${bin.filename}"`;
            reqContext.set.headers["Cache-Control"] = "public, max-age=300";
            reqContext.set.headers["Content-Length"] = String(bin.sizeBytes);
            logger.info(`[${reqContext.requestId} (KR-01)] KioskReleaseController.getBinary() completed.`);
            return bin.content;
        } catch (e) {
            logger.error(`[${reqContext.requestId} (KR-01)] KioskReleaseController.getBinary() error:`, e);
            return errorFromService(reqContext, e);
        }
    },
};
