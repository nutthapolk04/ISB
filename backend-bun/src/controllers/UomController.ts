/** Units of measure — CRUD /seed (auth; write: admin | manager) */
import type { Context } from "elysia";
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
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
		try {
			return successResponse(
				reqContext,
				await listUoms(query.active_only !== "false"),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	getById: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await getUom(id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await createUom({
					...body,
					name_en: body.name_en ?? undefined,
					base_uom_id: body.base_uom_id ?? undefined,
					conversion_factor: body.conversion_factor ?? undefined,
				}),
				ResponseStatus.CREATED,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	update: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await updateUom(id, body), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	remove: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await deleteUom(id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	seedDefaults: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(reqContext, await seedDefaultUoms(), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
