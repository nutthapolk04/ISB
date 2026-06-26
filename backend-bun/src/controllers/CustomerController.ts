/** Customers — search, CRUD, card/limit/allergy ops (auth; write: admin/staff per action) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import {
	searchCustomers,
	getCustomerByCode,
	getCustomerByCard,
	getCustomer,
	listCustomers,
	freezeCard,
	setActive,
	setDailyLimit,
	setDailyLimits,
	updateAllergies,
	setNegativeCreditLimit,
	bindCard,
	createStudent,
	updateCustomerBasic,
	deleteCustomer,
	graduateStudent,
} from "@/services/customer_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

const STAFF_ROLES = ["parent", "staff", "cashier", "manager", "kitchen", "admin"] as const;

export const CustomerController = {
	search: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		try {
			return successResponse(
				reqContext,
				await searchCustomers({
					q: query.q,
					limit: query.limit ? Number(query.limit) : undefined,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	getByCode: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		const c = await getCustomerByCode(params.code);
		if (!c) return errorResponse(reqContext, "Customer not found", ResponseStatus.NOT_FOUND);
		return successResponse(reqContext, c, ResponseStatus.OK);
	},

	getByCard: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		const c = await getCustomerByCard(params.uid);
		if (!c) return errorResponse(reqContext, "Card not bound", ResponseStatus.NOT_FOUND);
		return successResponse(reqContext, c, ResponseStatus.OK);
	},

	list: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		return successResponse(
			reqContext,
			await listCustomers({
				skip: query.skip ? Number(query.skip) : undefined,
				limit: query.limit ? Number(query.limit) : undefined,
				search: query.search ?? undefined,
				isActive:
					query.is_active === "true" ? true : query.is_active === "false" ? false : undefined,
			}),
			ResponseStatus.OK,
		);
	},

	getById: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		const c = await getCustomer(id);
		if (!c) return errorResponse(reqContext, "Customer not found", ResponseStatus.NOT_FOUND);
		return successResponse(reqContext, c, ResponseStatus.OK);
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(reqContext, await createStudent(body), ResponseStatus.CREATED);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	update: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await updateCustomerBasic(user, id, body), ResponseStatus.OK);
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
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		try {
			await deleteCustomer(id);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	freeze: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, ...STAFF_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await freezeCard(user, id, body.frozen), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	setActive: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await setActive(id, body.active), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	setLimit: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, ...STAFF_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		try {
			if ("daily_limit_canteen" in body || "daily_limit_store" in body) {
				return successResponse(
					reqContext,
					await setDailyLimits(user, id, {
						daily_limit_canteen: body.daily_limit_canteen ?? null,
						daily_limit_store: body.daily_limit_store ?? null,
					}),
					ResponseStatus.OK,
				);
			}
			return successResponse(
				reqContext,
				await setDailyLimit(user, id, body.daily_limit ?? null),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	updateAllergies: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await updateAllergies(id, body), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	setNegativeLimit: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await setNegativeCreditLimit(id, body.negative_credit_limit ?? null),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	bindCard: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await bindCard(id, body.card_uid ?? null), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	graduate: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await graduateStudent(user, id, {
					transfer_to_customer_id: body.transfer_to_customer_id ?? null,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
