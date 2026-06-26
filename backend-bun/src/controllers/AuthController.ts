/** Auth — login, refresh, SSO, me, role management */
import type { Context } from "elysia";
import { authedCtx, publicCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import {
	login as loginService,
	refresh as refreshService,
	logout as logoutService,
	me as meService,
	mockSso as mockSsoService,
	googleSso as googleSsoService,
	listUserRoles as listUserRolesService,
	assignRoleToUser,
	removeRoleFromUser,
} from "@/services/auth_service";
import { hasRole } from "@/middleware/AuthMiddleware";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

export const AuthController = {
	login: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const { body } = reqContext;
		try {
			return successResponse(reqContext, await loginService(body.username, body.password), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	refresh: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const { body } = reqContext;
		try {
			return successResponse(reqContext, await refreshService(body.refresh_token), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	mockSso: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const { body } = reqContext;
		try {
			return successResponse(reqContext, await mockSsoService(body.email), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	googleSso: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const { body } = reqContext;
		try {
			return successResponse(reqContext, await googleSsoService(body.access_token), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	logout: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		await logoutService(Number(user.sub));
		return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
	},

	jwtMe: (ctx: Context) => {
		const { user } = authedCtx(ctx);
		return {
			sub: user.sub,
			username: user.username,
			roles: user.roles,
			is_superuser: user.is_superuser,
		};
	},

	me: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		try {
			return successResponse(reqContext, await meService(Number(user.sub)), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	listUserRoles: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await listUserRolesService(id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	assignRole: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await assignRoleToUser(id, body.role_name), ResponseStatus.CREATED);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	removeRole: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await removeRoleFromUser(id, decodeURIComponent(params.role_name)),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
