/** Users — CRUD, lookup by card/username/family (auth) */
import type { Context } from "elysia";
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import {
	listUsers,
	getUser,
	getUserPayerByUsername,
	getUserPayerByCard,
	familyLookup,
	createUser,
	updateUser,
	deleteUser,
} from "@/services/user_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

export const UserController = {
	list: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		try {
			return successResponse(
				reqContext,
				await listUsers({
					caller: user as any,
					q: query.q,
					shopId: query.shop_id,
					role: query.role,
					unassigned: query.unassigned === "true",
					page: query.page ? Number(query.page) : undefined,
					pageSize: query.page_size ? Number(query.page_size) : undefined,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	byUsername: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		try {
			return successResponse(reqContext, await getUserPayerByUsername(params.username), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	byCard: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		try {
			return successResponse(reqContext, await getUserPayerByCard(params.uid), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	familyLookup: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		try {
			return successResponse(reqContext, await familyLookup(query.q), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	getById: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		const id = parseIntParam(params.id, "user id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await getUser(user as any, id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		try {
			return successResponse(reqContext, await createUser(user as any, body), ResponseStatus.CREATED);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	update: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		const id = parseIntParam(params.id, "user id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await updateUser(user as any, id, body), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	remove: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		const id = parseIntParam(params.id, "user id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		try {
			await deleteUser(user, id);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
