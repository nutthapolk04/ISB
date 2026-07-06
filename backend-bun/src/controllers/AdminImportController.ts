/** Admin import — templates, products, stock, store (admin | manager) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";
import { hasRole } from "@/middleware/AuthMiddleware";
import { buildTemplate, importProducts, importStockReceive, importStore } from "@/services/admin_import_service";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";
import { logger } from "@/logger";

type ImportUser = AccessTokenPayload & { shop_id?: string | null };

const IMPORT_ROLES = ["admin", "manager"] as const;

export const AdminImportController = {
    template: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { query } = reqContext;
        logger.info(`[${reqContext.requestId} (AI-01)] AdminImportController.template() called.`);
        if (!hasRole(user.roles, ...IMPORT_ROLES)) {
            logger.warn(`[${reqContext.requestId} (AI-01)] AdminImportController.template() forbidden.`);
            return errorResponse(reqContext, "Admin/manager only", ResponseStatus.FORBIDDEN);
        }
        try {
            logger.info(`[${reqContext.requestId} (AI-01)] AdminImportController.template() calling buildTemplate().`);
            const result = await buildTemplate(query.shop_id ?? "");
            logger.info(`[${reqContext.requestId} (AI-01)] AdminImportController.template() completed.`);
            return successResponse(reqContext, result, ResponseStatus.OK);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AI-01)] AdminImportController.template() error:`, e);
            return errorFromService(reqContext, e);
        }
    },

    products: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { body, query } = reqContext;
        logger.info(`[${reqContext.requestId} (AI-02)] AdminImportController.products() called.`);
        if (!hasRole(user.roles, ...IMPORT_ROLES)) {
            logger.warn(`[${reqContext.requestId} (AI-02)] AdminImportController.products() forbidden.`);
            return errorResponse(reqContext, "Admin/manager only", ResponseStatus.FORBIDDEN);
        }
        try {
            logger.info(`[${reqContext.requestId} (AI-02)] AdminImportController.products() calling importProducts().`);
            const result = await importProducts({
                caller: user as ImportUser,
                file: body.file,
                shopId: query.shop_id ?? "",
            });
            logger.info(`[${reqContext.requestId} (AI-02)] AdminImportController.products() completed.`);
            return successResponse(reqContext, result.body, result.status);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AI-02)] AdminImportController.products() error:`, e);
            return errorFromService(reqContext, e);
        }
    },

    stockReceive: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { body } = reqContext;
        logger.info(`[${reqContext.requestId} (AI-03)] AdminImportController.stockReceive() called.`);
        if (!hasRole(user.roles, ...IMPORT_ROLES)) {
            logger.warn(`[${reqContext.requestId} (AI-03)] AdminImportController.stockReceive() forbidden.`);
            return errorResponse(reqContext, "Admin/manager only", ResponseStatus.FORBIDDEN);
        }
        try {
            logger.info(`[${reqContext.requestId} (AI-03)] AdminImportController.stockReceive() calling importStockReceive().`);
            const result = await importStockReceive({
                caller: user as ImportUser,
                file: body.file,
            });
            logger.info(`[${reqContext.requestId} (AI-03)] AdminImportController.stockReceive() completed.`);
            return successResponse(reqContext, result.body, result.status);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AI-03)] AdminImportController.stockReceive() error:`, e);
            return errorFromService(reqContext, e);
        }
    },

    store: async (ctx: any) => {
        const { reqContext, user } = authedCtx(ctx);
        const { body, query } = reqContext;
        logger.info(`[${reqContext.requestId} (AI-04)] AdminImportController.store() called.`);
        if (!hasRole(user.roles, ...IMPORT_ROLES)) {
            logger.warn(`[${reqContext.requestId} (AI-04)] AdminImportController.store() forbidden.`);
            return errorResponse(reqContext, "Admin/manager only", ResponseStatus.FORBIDDEN);
        }
        try {
            logger.info(`[${reqContext.requestId} (AI-04)] AdminImportController.store() calling importStore().`);
            const result = await importStore({
                caller: user as ImportUser,
                file: body.file,
                shopId: query.shop_id ?? "",
                dryRun: query.dry_run === "true",
            });
            logger.info(`[${reqContext.requestId} (AI-04)] AdminImportController.store() completed.`);
            return successResponse(reqContext, result.body, result.status);
        } catch (e) {
            logger.error(`[${reqContext.requestId} (AI-04)] AdminImportController.store() error:`, e);
            return errorFromService(reqContext, e);
        }
    },
};
