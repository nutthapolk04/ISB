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

const USAGE_ROLES = ["parent", "staff", "cashier", "manager", "admin"] as const;

export const SpendingGroupController = {
	usageTodayByChild: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		if (!hasRole(user.roles, ...USAGE_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const customerId = Number(query.customer_id);
		if (!Number.isInteger(customerId) || customerId <= 0) {
			return errorResponse(reqContext, "Invalid customer_id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			return successResponse(
				reqContext,
				await getSpendingGroupsUsageToday(customerId),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	usageToday: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, query } = reqContext;
		if (!hasRole(user.roles, ...USAGE_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const groupId = parseIntParam(params.id, "id", reqContext.set);
		if (groupId === null || groupId <= 0) {
			return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		}
		const customerIdRaw = query.payer_customer_id ? Number(query.payer_customer_id) : null;
		const userIdRaw = query.payer_user_id ? Number(query.payer_user_id) : null;
		if (!customerIdRaw && !userIdRaw) {
			return errorResponse(
				reqContext,
				"payer_customer_id or payer_user_id required",
				ResponseStatus.UNPROCESSABLE,
			);
		}
		try {
			return successResponse(
				reqContext,
				await getSpendingGroupUsageToday(groupId, customerIdRaw, userIdRaw),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	list: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		try {
			return successResponse(reqContext, await listSpendingGroups(), ResponseStatus.OK);
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
			return successResponse(reqContext, await getSpendingGroup(id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		if (!user.is_superuser && !hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await createSpendingGroup({
					...body,
					is_active: body.is_active ?? undefined,
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
		if (!user.is_superuser && !hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await updateSpendingGroup(id, body), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	remove: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!user.is_superuser && !hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		try {
			await deleteSpendingGroup(id);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	listShops: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin", "manager")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await listAssignableShops(id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	setShops: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!user.is_superuser && !hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await setLinkedShops(id, body.shop_ids), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
