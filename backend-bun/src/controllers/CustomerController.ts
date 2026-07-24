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
import { logger } from "@/logger";

const STAFF_ROLES = ["parent", "staff", "cashier", "manager", "kitchen", "admin"] as const;

export const CustomerController = {
	search: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (CU-01)] CustomerController.search() called.`);
		try {
			logger.info(`[${reqContext.requestId} (CU-01)] CustomerController.search() calling searchCustomers().`);
			const result = await searchCustomers({
				q: query.q,
				limit: query.limit ? Number(query.limit) : undefined,
				narrow: query.narrow === "1" || query.narrow === "true",
			});
			logger.info(`[${reqContext.requestId} (CU-01)] CustomerController.search() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CU-01)] CustomerController.search() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getByCode: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (CU-02)] CustomerController.getByCode() called.`);
		try {
			logger.info(`[${reqContext.requestId} (CU-02)] CustomerController.getByCode() calling getCustomerByCode().`);
			const c = await getCustomerByCode(params.code);
			if (!c) {
				logger.warn(`[${reqContext.requestId} (CU-02)] CustomerController.getByCode() customer not found.`);
				return errorResponse(reqContext, "Customer not found", ResponseStatus.NOT_FOUND);
			}
			logger.info(`[${reqContext.requestId} (CU-02)] CustomerController.getByCode() completed.`);
			return successResponse(reqContext, c, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CU-02)] CustomerController.getByCode() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getByCard: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (CU-03)] CustomerController.getByCard() called.`);
		try {
			logger.info(`[${reqContext.requestId} (CU-03)] CustomerController.getByCard() calling getCustomerByCard().`);
			const c = await getCustomerByCard(params.uid);
			if (!c) {
				logger.warn(`[${reqContext.requestId} (CU-03)] CustomerController.getByCard() card not bound.`);
				return errorResponse(reqContext, "Card not bound", ResponseStatus.NOT_FOUND);
			}
			logger.info(`[${reqContext.requestId} (CU-03)] CustomerController.getByCard() completed.`);
			return successResponse(reqContext, c, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CU-03)] CustomerController.getByCard() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	list: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (CU-04)] CustomerController.list() called.`);
		try {
			logger.info(`[${reqContext.requestId} (CU-04)] CustomerController.list() calling listCustomers().`);
			const result = await listCustomers({
				skip: query.skip ? Number(query.skip) : undefined,
				limit: query.limit ? Number(query.limit) : undefined,
				search: query.search ?? undefined,
				isActive:
					query.is_active === "true" ? true : query.is_active === "false" ? false : undefined,
			});
			logger.info(`[${reqContext.requestId} (CU-04)] CustomerController.list() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CU-04)] CustomerController.list() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getById: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (CU-05)] CustomerController.getById() called.`);
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (CU-05)] CustomerController.getById() invalid customer id.`);
			return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (CU-05)] CustomerController.getById() calling getCustomer().`);
			const c = await getCustomer(id);
			if (!c) {
				logger.warn(`[${reqContext.requestId} (CU-05)] CustomerController.getById() customer not found.`);
				return errorResponse(reqContext, "Customer not found", ResponseStatus.NOT_FOUND);
			}
			logger.info(`[${reqContext.requestId} (CU-05)] CustomerController.getById() completed.`);
			return successResponse(reqContext, c, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CU-05)] CustomerController.getById() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (CU-06)] CustomerController.create() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (CU-06)] CustomerController.create() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (CU-06)] CustomerController.create() calling createStudent().`);
			const result = await createStudent(body, Number(user.sub));
			logger.info(`[${reqContext.requestId} (CU-06)] CustomerController.create() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CU-06)] CustomerController.create() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	update: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (CU-07)] CustomerController.update() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (CU-07)] CustomerController.update() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (CU-07)] CustomerController.update() invalid customer id.`);
			return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (CU-07)] CustomerController.update() calling updateCustomerBasic().`);
			const result = await updateCustomerBasic(user, id, body);
			logger.info(`[${reqContext.requestId} (CU-07)] CustomerController.update() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CU-07)] CustomerController.update() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	remove: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (CU-08)] CustomerController.remove() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (CU-08)] CustomerController.remove() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (CU-08)] CustomerController.remove() invalid customer id.`);
			return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (CU-08)] CustomerController.remove() calling deleteCustomer().`);
			await deleteCustomer(id);
			logger.info(`[${reqContext.requestId} (CU-08)] CustomerController.remove() completed.`);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CU-08)] CustomerController.remove() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	freeze: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (CU-09)] CustomerController.freeze() called.`);
		if (!hasRole(user.roles, ...STAFF_ROLES)) {
			logger.warn(`[${reqContext.requestId} (CU-09)] CustomerController.freeze() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (CU-09)] CustomerController.freeze() invalid customer id.`);
			return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (CU-09)] CustomerController.freeze() calling freezeCard().`);
			const result = await freezeCard(user, id, body.frozen);
			logger.info(`[${reqContext.requestId} (CU-09)] CustomerController.freeze() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CU-09)] CustomerController.freeze() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	setActive: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (CU-10)] CustomerController.setActive() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (CU-10)] CustomerController.setActive() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (CU-10)] CustomerController.setActive() invalid customer id.`);
			return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (CU-10)] CustomerController.setActive() calling setActive().`);
			const result = await setActive(id, body.active);
			logger.info(`[${reqContext.requestId} (CU-10)] CustomerController.setActive() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CU-10)] CustomerController.setActive() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	setLimit: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (CU-11)] CustomerController.setLimit() called.`);
		if (!hasRole(user.roles, ...STAFF_ROLES)) {
			logger.warn(`[${reqContext.requestId} (CU-11)] CustomerController.setLimit() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (CU-11)] CustomerController.setLimit() invalid customer id.`);
			return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (CU-11)] CustomerController.setLimit() calling setDailyLimit(s).`);
			let result;
			if ("daily_limit_canteen" in body || "daily_limit_store" in body) {
				result = await setDailyLimits(user, id, {
					daily_limit_canteen: body.daily_limit_canteen ?? null,
					daily_limit_store: body.daily_limit_store ?? null,
				});
			} else {
				result = await setDailyLimit(user, id, body.daily_limit ?? null);
			}
			logger.info(`[${reqContext.requestId} (CU-11)] CustomerController.setLimit() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CU-11)] CustomerController.setLimit() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	updateAllergies: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (CU-12)] CustomerController.updateAllergies() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (CU-12)] CustomerController.updateAllergies() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (CU-12)] CustomerController.updateAllergies() invalid customer id.`);
			return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (CU-12)] CustomerController.updateAllergies() calling updateAllergies().`);
			const result = await updateAllergies(id, body);
			logger.info(`[${reqContext.requestId} (CU-12)] CustomerController.updateAllergies() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CU-12)] CustomerController.updateAllergies() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	setNegativeLimit: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (CU-13)] CustomerController.setNegativeLimit() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (CU-13)] CustomerController.setNegativeLimit() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (CU-13)] CustomerController.setNegativeLimit() invalid customer id.`);
			return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (CU-13)] CustomerController.setNegativeLimit() calling setNegativeCreditLimit().`);
			const result = await setNegativeCreditLimit(id, body.negative_credit_limit ?? null);
			logger.info(`[${reqContext.requestId} (CU-13)] CustomerController.setNegativeLimit() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CU-13)] CustomerController.setNegativeLimit() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	bindCard: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (CU-14)] CustomerController.bindCard() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (CU-14)] CustomerController.bindCard() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (CU-14)] CustomerController.bindCard() invalid customer id.`);
			return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (CU-14)] CustomerController.bindCard() calling bindCard().`);
			const result = await bindCard(id, body.card_uid ?? null);
			logger.info(`[${reqContext.requestId} (CU-14)] CustomerController.bindCard() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CU-14)] CustomerController.bindCard() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	graduate: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (CU-15)] CustomerController.graduate() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (CU-15)] CustomerController.graduate() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "customer id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (CU-15)] CustomerController.graduate() invalid customer id.`);
			return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (CU-15)] CustomerController.graduate() calling graduateStudent().`);
			const result = await graduateStudent(user, id, {
				transfer_to_customer_id: body.transfer_to_customer_id ?? null,
			});
			logger.info(`[${reqContext.requestId} (CU-15)] CustomerController.graduate() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (CU-15)] CustomerController.graduate() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
