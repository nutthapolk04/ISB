/** Admin settings — flags, school config, test email (admin) */
import type { Context } from "elysia";
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import {
    KNOWN_FLAGS,
    SCHOOL_KEYS,
    getSchoolSettings,
    listKnown,
    setSchoolSettings,
    setValue,
} from "@/services/settings_service";
import { sendEmail } from "@/services/email_service";
import { errorResponse, successResponse } from "@/utils/ResponseUtil";
import { logger } from "@/logger";

export const AdminSettingsController = {
    listKnown: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        logger.info(`[${reqContext.requestId} (AS-01)] AdminSettingsController.listKnown() called.`);
        if (!hasRole(user.roles, "admin")) {
            logger.warn(`[${reqContext.requestId} (AS-01)] AdminSettingsController.listKnown() forbidden.`);
            return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
        }
        logger.info(`[${reqContext.requestId} (AS-01)] AdminSettingsController.listKnown() calling listKnown().`);
        return successResponse(reqContext, await listKnown(), ResponseStatus.OK);
    },

    getSchoolSettings: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        logger.info(`[${reqContext.requestId} (AS-02)] AdminSettingsController.getSchoolSettings() called.`);
        if (!hasRole(user.roles, "admin")) {
            logger.warn(`[${reqContext.requestId} (AS-02)] AdminSettingsController.getSchoolSettings() forbidden.`);
            return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
        }
        logger.info(`[${reqContext.requestId} (AS-02)] AdminSettingsController.getSchoolSettings() calling getSchoolSettings().`);
        return successResponse(reqContext, await getSchoolSettings(), ResponseStatus.OK);
    },

    setSchoolSettings: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { body } = reqContext;
        logger.info(`[${reqContext.requestId} (AS-03)] AdminSettingsController.setSchoolSettings() called.`);
        if (!hasRole(user.roles, "admin")) {
            logger.warn(`[${reqContext.requestId} (AS-03)] AdminSettingsController.setSchoolSettings() forbidden.`);
            return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
        }
        const userId = Number(user.sub);
        logger.info(`[${reqContext.requestId} (AS-03)] AdminSettingsController.setSchoolSettings() calling setSchoolSettings().`);
        return successResponse(reqContext, await setSchoolSettings(body, userId), ResponseStatus.OK);
    },

    setValue: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { params, body } = reqContext;
        logger.info(`[${reqContext.requestId} (AS-04)] AdminSettingsController.setValue() called.`);
        if (!hasRole(user.roles, "admin")) {
            logger.warn(`[${reqContext.requestId} (AS-04)] AdminSettingsController.setValue() forbidden.`);
            return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
        }
        const key = params.key;
        if (!(key in KNOWN_FLAGS) && !SCHOOL_KEYS.has(key)) {
            logger.warn(`[${reqContext.requestId} (AS-04)] AdminSettingsController.setValue() unknown setting key '${key}'.`);
            return errorResponse(reqContext, `Unknown setting key '${key}'`, ResponseStatus.NOT_FOUND);
        }
        const userId = Number(user.sub);
        logger.info(`[${reqContext.requestId} (AS-04)] AdminSettingsController.setValue() calling setValue().`);
        const newValue = await setValue(key, body.value, userId);
        logger.info(`[${reqContext.requestId} (AS-04)] AdminSettingsController.setValue() completed.`);
        return successResponse(reqContext, { key, value: newValue }, ResponseStatus.OK);
    },

    testEmail: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { body } = reqContext;
        logger.info(`[${reqContext.requestId} (AS-05)] AdminSettingsController.testEmail() called.`);
        if (!hasRole(user.roles, "admin", "manager")) {
            logger.warn(`[${reqContext.requestId} (AS-05)] AdminSettingsController.testEmail() forbidden.`);
            return errorResponse(reqContext, "Admin/manager only", ResponseStatus.FORBIDDEN);
        }
        const to = body.to ?? user.email;
        if (!to) {
            logger.warn(`[${reqContext.requestId} (AS-05)] AdminSettingsController.testEmail() no recipient email.`);
            return errorResponse(reqContext, "No recipient email", ResponseStatus.BAD_REQUEST);
        }
        try {
            logger.info(`[${reqContext.requestId} (AS-05)] AdminSettingsController.testEmail() calling sendEmail().`);
            await sendEmail(
                to,
                "ISB — Test Email",
                `<p>Test email sent successfully at ${new Date().toISOString()}</p>`,
            );
            return successResponse(reqContext, { sent: true, to }, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AS-05)] AdminSettingsController.testEmail() error:`, e);
            return errorResponse(
                reqContext,
                e instanceof Error ? e.message : String(e),
                ResponseStatus.INTERNAL_ERROR,
            );
        }
    },
};
