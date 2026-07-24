/** Kiosk device — profile / location label / event-log upload (role=kiosk) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { getKioskProfile, updateKioskLocation, ingestKioskLogs } from "@/services/kiosk_service";
import { recordHeartbeat } from "@/services/kiosk_monitoring_service";
import { errorFromService, successResponse } from "@/utils/ResponseUtil";
import { logger } from "@/logger";

export const KioskController = {
    me: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        logger.info(`[${reqContext.requestId} (KC-01)] KioskController.me() called.`);
        try {
            const result = await getKioskProfile(user as Parameters<typeof getKioskProfile>[0]);
            return successResponse(reqContext, result, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (KC-01)] KioskController.me() error:`, e);
            return errorFromService(reqContext, e);
        }
    },

    updateLocation: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { body } = reqContext;
        logger.info(`[${reqContext.requestId} (KC-02)] KioskController.updateLocation() called.`);
        try {
            const result = await updateKioskLocation(
                user as Parameters<typeof updateKioskLocation>[0],
                body.full_name,
            );
            return successResponse(reqContext, result, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (KC-02)] KioskController.updateLocation() error:`, e);
            return errorFromService(reqContext, e);
        }
    },

    heartbeat: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        logger.info(`[${reqContext.requestId} (KC-04)] KioskController.heartbeat() called.`);
        try {
            const result = await recordHeartbeat(user as Parameters<typeof recordHeartbeat>[0]);
            return successResponse(reqContext, result, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (KC-04)] KioskController.heartbeat() error:`, e);
            return errorFromService(reqContext, e);
        }
    },

    uploadLogs: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { body } = reqContext;
        logger.info(`[${reqContext.requestId} (KC-03)] KioskController.uploadLogs() called (${body.entries.length} entries).`);
        try {
            const result = await ingestKioskLogs(user as Parameters<typeof ingestKioskLogs>[0], body.entries);
            logger.info(`[${reqContext.requestId} (KC-03)] KioskController.uploadLogs() inserted ${result.inserted}.`);
            return successResponse(reqContext, result, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (KC-03)] KioskController.uploadLogs() error:`, e);
            return errorFromService(reqContext, e);
        }
    },
};
