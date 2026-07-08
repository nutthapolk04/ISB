/** Units of measure — CRUD /seed (auth; write: admin | manager) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import { logger } from "@/logger";
import {
	listUoms,
	getUom,
	createUom,
	updateUom,
	deleteUom,
	seedDefaultUoms,
} from "@/services/uom_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

export const UomController = {
	list: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (UM-01)] UomController.list() called.`);
		try {
			logger.info(`[${reqContext.requestId} (UM-01)] UomController.list() calling listUoms().`);
			const result = await listUoms(query.active_only !== "false");
			logger.info(`[${reqContext.requestId} (UM-01)] UomController.list() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UM-01)] UomController.list() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getById: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (UM-02)] UomController.getById() called.`);
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (UM-02)] UomController.getById() invalid id.`);
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (UM-02)] UomController.getById() calling getUom().`);
			const result = await getUom(id);
			logger.info(`[${reqContext.requestId} (UM-02)] UomController.getById() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UM-02)] UomController.getById() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (UM-03)] UomController.create() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (UM-03)] UomController.create() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (UM-03)] UomController.create() calling createUom().`);
			const result = await createUom({
				...body,
				name_en: body.name_en ?? undefined,
				base_uom_id: body.base_uom_id ?? undefined,
				conversion_factor: body.conversion_factor ?? undefined,
			});
			logger.info(`[${reqContext.requestId} (UM-03)] UomController.create() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UM-03)] UomController.create() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	update: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (UM-04)] UomController.update() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (UM-04)] UomController.update() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (UM-04)] UomController.update() invalid id.`);
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (UM-04)] UomController.update() calling updateUom().`);
			const result = await updateUom(id, body);
			logger.info(`[${reqContext.requestId} (UM-04)] UomController.update() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UM-04)] UomController.update() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	remove: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (UM-05)] UomController.remove() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (UM-05)] UomController.remove() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (UM-05)] UomController.remove() invalid id.`);
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (UM-05)] UomController.remove() calling deleteUom().`);
			const result = await deleteUom(id);
			logger.info(`[${reqContext.requestId} (UM-05)] UomController.remove() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UM-05)] UomController.remove() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	seedDefaults: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		logger.info(`[${reqContext.requestId} (UM-06)] UomController.seedDefaults() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (UM-06)] UomController.seedDefaults() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (UM-06)] UomController.seedDefaults() calling seedDefaultUoms().`);
			const result = await seedDefaultUoms();
			logger.info(`[${reqContext.requestId} (UM-06)] UomController.seedDefaults() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UM-06)] UomController.seedDefaults() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
