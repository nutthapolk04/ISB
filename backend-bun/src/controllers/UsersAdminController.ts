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

export const UsersAdminController = {
	list: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		return successResponse(
			reqContext,
			await listAdminUsers({
				role: query.role,
				q: query.q,
				status: query.status,
			}),
			ResponseStatus.OK,
		);
	},

	staffPicker: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		return successResponse(
			reqContext,
			await listStaffForPicker({ q: query.q, roles: query.roles }),
			ResponseStatus.OK,
		);
	},

	listStudents: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		return successResponse(reqContext, await listStudentsForLink(query.q), ResponseStatus.OK);
	},

	createStudent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		try {
			return successResponse(
				reqContext,
				await createStudentUserAccount(user.roles, body),
				ResponseStatus.CREATED,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	getById: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await getAdminUser(user.roles, id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	update: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await updateAdminUser(user.roles, Number(user.sub), id, body),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	getFamily: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await getUserFamily(user.roles, id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	updateFamilyProfile: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		try {
			return successResponse(
				reqContext,
				await updateFamilyProfile(user.roles, params.family_code, body),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	linkStudent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await linkStudentToUser(user.roles, id, body),
				ResponseStatus.CREATED,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	unlinkStudent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		const userId = parseIntParam(params.user_id, "user id", reqContext.set);
		const customerId = parseIntParam(params.customer_id, "customer id", reqContext.set);
		if (userId === null || customerId === null) {
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			return successResponse(
				reqContext,
				await unlinkStudent(user.roles, userId, customerId),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
