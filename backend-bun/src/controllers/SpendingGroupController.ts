import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
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
import { handleServiceError, forbidden, adminOnly } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

const USAGE_ROLES = ["parent", "staff", "cashier", "manager", "admin"] as const;

export const SpendingGroupController = {
    usageTodayByChild: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, ...USAGE_ROLES)) return forbidden(set);
        const customerId = Number(query.customer_id);
        if (!Number.isInteger(customerId) || customerId <= 0) {
            set.status = 422;
            return { detail: "Invalid customer_id" };
        }
        try {
            return await getSpendingGroupsUsageToday(customerId);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    usageToday: async (ctx: any) => {
        const { params, query, user, set } = ctx;
        if (!hasRole(user.roles, ...USAGE_ROLES)) return forbidden(set);
        const groupId = parseIntParam(params.id, "id", set);
        if (groupId === null || groupId <= 0) {
            set.status = 422;
            return { detail: "Invalid id" };
        }
        const customerIdRaw = query.payer_customer_id ? Number(query.payer_customer_id) : null;
        const userIdRaw = query.payer_user_id ? Number(query.payer_user_id) : null;
        if (!customerIdRaw && !userIdRaw) {
            set.status = 422;
            return { detail: "payer_customer_id or payer_user_id required" };
        }
        try {
            return await getSpendingGroupUsageToday(groupId, customerIdRaw, userIdRaw);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    list: async (ctx: any) => {
        const { set } = ctx;
        try {
            return await listSpendingGroups();
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    getById: async (ctx: any) => {
        const { params, set } = ctx;
        const id = parseIntParam(params.id, "id", set);
        if (id === null) return { detail: "Invalid id" };
        try {
            return await getSpendingGroup(id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    create: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!user.is_superuser && !hasRole(user.roles, "admin")) return adminOnly(set);
        try {
            set.status = 201;
            return await createSpendingGroup({
                ...body,
                is_active: body.is_active ?? undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    update: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!user.is_superuser && !hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.id, "id", set);
        if (id === null) return { detail: "Invalid id" };
        try {
            return await updateSpendingGroup(id, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    remove: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!user.is_superuser && !hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.id, "id", set);
        if (id === null) return { detail: "Invalid id" };
        try {
            await deleteSpendingGroup(id);
            set.status = 204;
            return null;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    listShops: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return forbidden(set);
        const id = parseIntParam(params.id, "id", set);
        if (id === null) return { detail: "Invalid id" };
        try {
            return await listAssignableShops(id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    setShops: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!user.is_superuser && !hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.id, "id", set);
        if (id === null) return { detail: "Invalid id" };
        try {
            return await setLinkedShops(id, body.shop_ids);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
