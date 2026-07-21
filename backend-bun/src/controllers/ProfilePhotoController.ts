/** ISB profile photos — public binary from local SFTP upload directory */
import { publicCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { logger } from "@/logger";
import { readProfilePhoto } from "@/services/isb_profile_photo_service";
import { errorFromService, errorResponse } from "@/utils/ResponseUtil";

export const ProfilePhotoController = {
    getBinary: async (ctx: any) => {
        const reqContext = publicCtx(ctx);
        const { params } = reqContext;
        const filename = params.filename;
        logger.info(`[${reqContext.requestId} (PP-01)] ProfilePhotoController.getBinary() called.`);
        if (!filename || typeof filename !== "string") {
            return errorResponse(reqContext, "filename is required", ResponseStatus.UNPROCESSABLE);
        }
        try {
            logger.debug(`[${reqContext.requestId} (PP-01)] ProfilePhotoController.getBinary() filename: ${filename}`);
            const bin = await readProfilePhoto(filename);
            reqContext.set.headers["Content-Type"] = bin.contentType;
            reqContext.set.headers["Cache-Control"] = "public, max-age=86400";
            reqContext.set.headers["Content-Length"] = String(bin.sizeBytes);
            logger.info(`[${reqContext.requestId} (PP-01)] ProfilePhotoController.getBinary() completed.`);
            return bin.content;
        } catch (e) {
            logger.error(`[${reqContext.requestId} (PP-01)] ProfilePhotoController.getBinary() error:`, e);
            return errorFromService(reqContext, e);
        }
    },
};
