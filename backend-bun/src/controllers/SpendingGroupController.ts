/** Spending groups — CRUD, shop links, usage-today (auth; write: admin) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import {
	getSpendingGroupsUsageToday,
	getSpendingGroupUsageToday,
} from "@/services/customer_service";
import {
	listSpendingGroups,
	getSpendingGroup,
	createSpendingGroup,
	updateSpendingGroup,
	deleteSpendingGroup,
	listAssignableShops,
	setLinkedShops,
} from "@/services/spending_group_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";
import { logger } from "@/logger";

const USAGE_ROLES = ["parent", "staff", "cashier", "manager", "admin"] as const;

export const SpendingGroupController = {
	usageTodayByChild: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (SG-01)] SpendingGroupController.usageTodayByChild() called.`);
		if (!hasRole(user.roles, ...USAGE_ROLES)) {
			logger.warn(`[${reqContext.requestId} (SG-01)] SpendingGroupController.usageTodayByChild() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const customerId = Number(query.customer_id);
		if (!Number.isInteger(customerId) || customerId <= 0) {
			logger.warn(`[${reqContext.requestId} (SG-01)] SpendingGroupController.usageTodayByChild() invalid customer_id.`);
			return errorResponse(reqContext, "Invalid customer_id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (SG-01)] SpendingGroupController.usageTodayByChild() calling getSpendingGroupsUsageToday().`);
			const result = await getSpendingGroupsUsageToday(customerId);
			logger.info(`[${reqContext.requestId} (SG-01)] SpendingGroupController.usageTodayByChild() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SG-01)] SpendingGroupController.usageTodayByChild() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	usageToday: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, query } = reqContext;
		logger.info(`[${reqContext.requestId} (SG-02)] SpendingGroupController.usageToday() called.`);
		if (!hasRole(user.roles, ...USAGE_ROLES)) {
			logger.warn(`[${reqContext.requestId} (SG-02)] SpendingGroupController.usageToday() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const groupId = parseIntParam(params.id, "id", reqContext.set);
		if (groupId === null || groupId <= 0) {
			logger.warn(`[${reqContext.requestId} (SG-02)] SpendingGroupController.usageToday() invalid id.`);
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		const customerIdRaw = query.payer_customer_id ? Number(query.payer_customer_id) : null;
		const userIdRaw = query.payer_user_id ? Number(query.payer_user_id) : null;
		if (!customerIdRaw && !userIdRaw) {
			logger.warn(`[${reqContext.requestId} (SG-02)] SpendingGroupController.usageToday() missing payer id.`);
			return errorResponse(
				reqContext,
				"payer_customer_id or payer_user_id required",
				ResponseStatus.UNPROCESSABLE,
			);
		}
		try {
			logger.info(`[${reqContext.requestId} (SG-02)] SpendingGroupController.usageToday() calling getSpendingGroupUsageToday().`);
			const result = await getSpendingGroupUsageToday(groupId, customerIdRaw, userIdRaw);
			logger.info(`[${reqContext.requestId} (SG-02)] SpendingGroupController.usageToday() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SG-02)] SpendingGroupController.usageToday() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	list: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		logger.info(`[${reqContext.requestId} (SG-03)] SpendingGroupController.list() called.`);
		try {
			logger.info(`[${reqContext.requestId} (SG-03)] SpendingGroupController.list() calling listSpendingGroups().`);
			const result = await listSpendingGroups();
			logger.info(`[${reqContext.requestId} (SG-03)] SpendingGroupController.list() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SG-03)] SpendingGroupController.list() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getById: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SG-04)] SpendingGroupController.getById() called.`);
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (SG-04)] SpendingGroupController.getById() invalid id.`);
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (SG-04)] SpendingGroupController.getById() calling getSpendingGroup().`);
			const result = await getSpendingGroup(id);
			logger.info(`[${reqContext.requestId} (SG-04)] SpendingGroupController.getById() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SG-04)] SpendingGroupController.getById() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (SG-05)] SpendingGroupController.create() called.`);
		if (!user.is_superuser && !hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (SG-05)] SpendingGroupController.create() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (SG-05)] SpendingGroupController.create() calling createSpendingGroup().`);
			const result = await createSpendingGroup({
				...body,
				is_active: body.is_active ?? undefined,
			});
			logger.info(`[${reqContext.requestId} (SG-05)] SpendingGroupController.create() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SG-05)] SpendingGroupController.create() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	update: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SG-06)] SpendingGroupController.update() called.`);
		if (!user.is_superuser && !hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (SG-06)] SpendingGroupController.update() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (SG-06)] SpendingGroupController.update() invalid id.`);
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (SG-06)] SpendingGroupController.update() calling updateSpendingGroup().`);
			const result = await updateSpendingGroup(id, body);
			logger.info(`[${reqContext.requestId} (SG-06)] SpendingGroupController.update() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SG-06)] SpendingGroupController.update() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	remove: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SG-07)] SpendingGroupController.remove() called.`);
		if (!user.is_superuser && !hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (SG-07)] SpendingGroupController.remove() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (SG-07)] SpendingGroupController.remove() invalid id.`);
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (SG-07)] SpendingGroupController.remove() calling deleteSpendingGroup().`);
			await deleteSpendingGroup(id);
			logger.info(`[${reqContext.requestId} (SG-07)] SpendingGroupController.remove() completed.`);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SG-07)] SpendingGroupController.remove() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	listShops: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (SG-08)] SpendingGroupController.listShops() called.`);
		if (!hasRole(user.roles, "admin", "manager")) {
			logger.warn(`[${reqContext.requestId} (SG-08)] SpendingGroupController.listShops() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (SG-08)] SpendingGroupController.listShops() invalid id.`);
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (SG-08)] SpendingGroupController.listShops() calling listAssignableShops().`);
			const result = await listAssignableShops(id);
			logger.info(`[${reqContext.requestId} (SG-08)] SpendingGroupController.listShops() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SG-08)] SpendingGroupController.listShops() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	setShops: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (SG-09)] SpendingGroupController.setShops() called.`);
		if (!user.is_superuser && !hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (SG-09)] SpendingGroupController.setShops() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (SG-09)] SpendingGroupController.setShops() invalid id.`);
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (SG-09)] SpendingGroupController.setShops() calling setLinkedShops().`);
			const result = await setLinkedShops(id, body.shop_ids);
			logger.info(`[${reqContext.requestId} (SG-09)] SpendingGroupController.setShops() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (SG-09)] SpendingGroupController.setShops() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
