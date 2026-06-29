/** Admin users — staff/student accounts, family links (admin) */
import type { Context } from "elysia";
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import {
	listAdminUsers,
	listStaffForPicker,
	listStudentsForLink,
	getAdminUser,
	updateAdminUser,
	createStudent as createStudentUserAccount,
	getUserFamily,
	updateFamilyProfile,
	linkStudentToUser,
	unlinkStudent,
} from "@/services/user_admin_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";
import { logger } from "@/logger";

export const UsersAdminController = {
	list: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (UA-01)] UsersAdminController.list() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (UA-01)] UsersAdminController.list() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (UA-01)] UsersAdminController.list() calling listAdminUsers().`);
			const result = await listAdminUsers({
				role: query.role,
				q: query.q,
				status: query.status,
			});
			logger.info(`[${reqContext.requestId} (UA-01)] UsersAdminController.list() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UA-01)] UsersAdminController.list() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	staffPicker: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (UA-02)] UsersAdminController.staffPicker() called.`);
		try {
			logger.info(`[${reqContext.requestId} (UA-02)] UsersAdminController.staffPicker() calling listStaffForPicker().`);
			const result = await listStaffForPicker({ q: query.q, roles: query.roles });
			logger.info(`[${reqContext.requestId} (UA-02)] UsersAdminController.staffPicker() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UA-02)] UsersAdminController.staffPicker() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	listStudents: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (UA-03)] UsersAdminController.listStudents() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (UA-03)] UsersAdminController.listStudents() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (UA-03)] UsersAdminController.listStudents() calling listStudentsForLink().`);
			const result = await listStudentsForLink(query.q);
			logger.info(`[${reqContext.requestId} (UA-03)] UsersAdminController.listStudents() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UA-03)] UsersAdminController.listStudents() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	createStudent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (UA-04)] UsersAdminController.createStudent() called.`);
		try {
			logger.info(`[${reqContext.requestId} (UA-04)] UsersAdminController.createStudent() calling createStudentUserAccount().`);
			const result = await createStudentUserAccount(user.roles, body);
			logger.info(`[${reqContext.requestId} (UA-04)] UsersAdminController.createStudent() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UA-04)] UsersAdminController.createStudent() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getById: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (UA-05)] UsersAdminController.getById() called.`);
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (UA-05)] UsersAdminController.getById() invalid user id.`);
			return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (UA-05)] UsersAdminController.getById() calling getAdminUser().`);
			const result = await getAdminUser(user.roles, id);
			logger.info(`[${reqContext.requestId} (UA-05)] UsersAdminController.getById() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UA-05)] UsersAdminController.getById() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	update: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (UA-06)] UsersAdminController.update() called.`);
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (UA-06)] UsersAdminController.update() invalid user id.`);
			return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (UA-06)] UsersAdminController.update() calling updateAdminUser().`);
			const result = await updateAdminUser(user.roles, Number(user.sub), id, body);
			logger.info(`[${reqContext.requestId} (UA-06)] UsersAdminController.update() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UA-06)] UsersAdminController.update() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getFamily: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (UA-07)] UsersAdminController.getFamily() called.`);
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (UA-07)] UsersAdminController.getFamily() invalid user id.`);
			return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (UA-07)] UsersAdminController.getFamily() calling getUserFamily().`);
			const result = await getUserFamily(user.roles, id);
			logger.info(`[${reqContext.requestId} (UA-07)] UsersAdminController.getFamily() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UA-07)] UsersAdminController.getFamily() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	updateFamilyProfile: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (UA-08)] UsersAdminController.updateFamilyProfile() called.`);
		try {
			logger.info(`[${reqContext.requestId} (UA-08)] UsersAdminController.updateFamilyProfile() calling updateFamilyProfile().`);
			const result = await updateFamilyProfile(user.roles, params.family_code, body);
			logger.info(`[${reqContext.requestId} (UA-08)] UsersAdminController.updateFamilyProfile() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UA-08)] UsersAdminController.updateFamilyProfile() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	linkStudent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (UA-09)] UsersAdminController.linkStudent() called.`);
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (UA-09)] UsersAdminController.linkStudent() invalid user id.`);
			return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (UA-09)] UsersAdminController.linkStudent() calling linkStudentToUser().`);
			const result = await linkStudentToUser(user.roles, id, body);
			logger.info(`[${reqContext.requestId} (UA-09)] UsersAdminController.linkStudent() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UA-09)] UsersAdminController.linkStudent() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	unlinkStudent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (UA-10)] UsersAdminController.unlinkStudent() called.`);
		const userId = parseIntParam(params.user_id, "user id", reqContext.set);
		const customerId = parseIntParam(params.customer_id, "customer id", reqContext.set);
		if (userId === null || customerId === null) {
			logger.warn(`[${reqContext.requestId} (UA-10)] UsersAdminController.unlinkStudent() invalid id.`);
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (UA-10)] UsersAdminController.unlinkStudent() calling unlinkStudent().`);
			const result = await unlinkStudent(user.roles, userId, customerId);
			logger.info(`[${reqContext.requestId} (UA-10)] UsersAdminController.unlinkStudent() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (UA-10)] UsersAdminController.unlinkStudent() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
