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
	googleSsoCode as googleSsoCodeService,
	listUserRoles as listUserRolesService,
	assignRoleToUser,
	removeRoleFromUser,
} from "@/services/auth_service";
import { hasRole } from "@/middleware/AuthMiddleware";
import { logger } from "@/logger";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

export const AuthController = {
	login: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (AU-01)] AuthController.login() called.`);
		try {
			logger.info(`[${reqContext.requestId} (AU-01)] AuthController.login() calling login().`);
			const result = await loginService(body.username, body.password);
			logger.info(`[${reqContext.requestId} (AU-01)] AuthController.login() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (AU-01)] AuthController.login() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	refresh: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (AU-02)] AuthController.refresh() called.`);
		try {
			logger.info(`[${reqContext.requestId} (AU-02)] AuthController.refresh() calling refresh().`);
			const result = await refreshService(body.refresh_token);
			logger.info(`[${reqContext.requestId} (AU-02)] AuthController.refresh() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (AU-02)] AuthController.refresh() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	mockSso: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (AU-03)] AuthController.mockSso() called.`);
		try {
			logger.info(`[${reqContext.requestId} (AU-03)] AuthController.mockSso() calling mockSso().`);
			const result = await mockSsoService(body.email);
			logger.info(`[${reqContext.requestId} (AU-03)] AuthController.mockSso() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (AU-03)] AuthController.mockSso() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	googleSso: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (AU-04)] AuthController.googleSso() called.`);
		try {
			logger.info(`[${reqContext.requestId} (AU-04)] AuthController.googleSso() calling googleSso().`);
			const result = await googleSsoService(body.access_token);
			logger.info(`[${reqContext.requestId} (AU-04)] AuthController.googleSso() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (AU-04)] AuthController.googleSso() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	googleSsoCallback: async (ctx: any) => {
		const reqContext = publicCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (AU-11)] AuthController.googleSsoCallback() called.`);
		try {
			logger.info(`[${reqContext.requestId} (AU-11)] AuthController.googleSsoCallback() calling googleSsoCode().`);
			const result = await googleSsoCodeService(body.code, body.redirect_uri);
			logger.info(`[${reqContext.requestId} (AU-11)] AuthController.googleSsoCallback() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (AU-11)] AuthController.googleSsoCallback() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	logout: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		logger.info(`[${reqContext.requestId} (AU-05)] AuthController.logout() called.`);
		try {
			logger.info(`[${reqContext.requestId} (AU-05)] AuthController.logout() calling logout().`);
			await logoutService(Number(user.sub));
			logger.info(`[${reqContext.requestId} (AU-05)] AuthController.logout() completed.`);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (AU-05)] AuthController.logout() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	jwtMe: (ctx: Context) => {
		const { reqContext, user } = authedCtx(ctx);
		logger.info(`[${reqContext.requestId} (AU-06)] AuthController.jwtMe() called.`);
		return {
			sub: user.sub,
			username: user.username,
			roles: user.roles,
			is_superuser: user.is_superuser,
		};
	},

	me: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		logger.info(`[${reqContext.requestId} (AU-07)] AuthController.me() called.`);
		try {
			logger.info(`[${reqContext.requestId} (AU-07)] AuthController.me() calling me().`);
			const result = await meService(Number(user.sub));
			logger.info(`[${reqContext.requestId} (AU-07)] AuthController.me() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (AU-07)] AuthController.me() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	listUserRoles: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (AU-08)] AuthController.listUserRoles() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (AU-08)] AuthController.listUserRoles() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (AU-08)] AuthController.listUserRoles() invalid user id.`);
			return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (AU-08)] AuthController.listUserRoles() calling listUserRoles().`);
			const result = await listUserRolesService(id);
			logger.info(`[${reqContext.requestId} (AU-08)] AuthController.listUserRoles() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (AU-08)] AuthController.listUserRoles() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	assignRole: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (AU-09)] AuthController.assignRole() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (AU-09)] AuthController.assignRole() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (AU-09)] AuthController.assignRole() invalid user id.`);
			return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (AU-09)] AuthController.assignRole() calling assignRoleToUser().`);
			const result = await assignRoleToUser(id, body.role_name);
			logger.info(`[${reqContext.requestId} (AU-09)] AuthController.assignRole() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (AU-09)] AuthController.assignRole() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	removeRole: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (AU-10)] AuthController.removeRole() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (AU-10)] AuthController.removeRole() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (AU-10)] AuthController.removeRole() invalid user id.`);
			return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (AU-10)] AuthController.removeRole() calling removeRoleFromUser().`);
			const result = await removeRoleFromUser(id, decodeURIComponent(params.role_name));
			logger.info(`[${reqContext.requestId} (AU-10)] AuthController.removeRole() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (AU-10)] AuthController.removeRole() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
