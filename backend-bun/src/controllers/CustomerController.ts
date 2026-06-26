import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
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
import { handleServiceError, adminOnly, forbidden } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

const STAFF_ROLES = ["parent", "staff", "cashier", "manager", "kitchen", "admin"] as const;

export const CustomerController = {
    search: async (ctx: any) => {
        const { query, set } = ctx;
        try {
            return await searchCustomers({
                q: query.q,
                limit: query.limit ? Number(query.limit) : undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    getByCode: async (ctx: any) => {
        const { params, set } = ctx;
        const c = await getCustomerByCode(params.code);
        if (!c) {
            set.status = 404;
            return { detail: "Customer not found" };
        }
        return c;
    },

    getByCard: async (ctx: any) => {
        const { params, set } = ctx;
        const c = await getCustomerByCard(params.uid);
        if (!c) {
            set.status = 404;
            return { detail: "Card not bound" };
        }
        return c;
    },

    list: async (ctx: any) => {
        const { query } = ctx;
        return await listCustomers({
            skip: query.skip ? Number(query.skip) : undefined,
            limit: query.limit ? Number(query.limit) : undefined,
            search: query.search ?? undefined,
            isActive:
                query.is_active === "true" ? true : query.is_active === "false" ? false : undefined,
        });
    },

    getById: async (ctx: any) => {
        const { params, set } = ctx;
        const id = parseIntParam(params.id, "customer id", set);
        if (id === null) return { detail: "Invalid customer id" };
        const c = await getCustomer(id);
        if (!c) {
            set.status = 404;
            return { detail: "Customer not found" };
        }
        return c;
    },

    create: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        try {
            set.status = 201;
            return await createStudent(body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    update: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.id, "customer id", set);
        if (id === null) return { detail: "Invalid customer id" };
        try {
            return await updateCustomerBasic(user, id, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    remove: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.id, "customer id", set);
        if (id === null) return { detail: "Invalid customer id" };
        try {
            await deleteCustomer(id);
            set.status = 204;
            return null;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    freeze: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, ...STAFF_ROLES)) return forbidden(set);
        const id = parseIntParam(params.id, "customer id", set);
        if (id === null) return { detail: "Invalid customer id" };
        try {
            return await freezeCard(user, id, body.frozen);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    setActive: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.id, "customer id", set);
        if (id === null) return { detail: "Invalid customer id" };
        try {
            return await setActive(id, body.active);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    setLimit: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, ...STAFF_ROLES)) return forbidden(set);
        const id = parseIntParam(params.id, "customer id", set);
        if (id === null) return { detail: "Invalid customer id" };
        try {
            if ("daily_limit_canteen" in body || "daily_limit_store" in body) {
                return await setDailyLimits(user, id, {
                    daily_limit_canteen: body.daily_limit_canteen ?? null,
                    daily_limit_store: body.daily_limit_store ?? null,
                });
            }
            return await setDailyLimit(user, id, body.daily_limit ?? null);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    updateAllergies: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return forbidden(set);
        const id = parseIntParam(params.id, "customer id", set);
        if (id === null) return { detail: "Invalid customer id" };
        try {
            return await updateAllergies(id, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    setNegativeLimit: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.id, "customer id", set);
        if (id === null) return { detail: "Invalid customer id" };
        try {
            return await setNegativeCreditLimit(id, body.negative_credit_limit ?? null);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    bindCard: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.id, "customer id", set);
        if (id === null) return { detail: "Invalid customer id" };
        try {
            return await bindCard(id, body.card_uid ?? null);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    graduate: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.id, "customer id", set);
        if (id === null) return { detail: "Invalid customer id" };
        try {
            return await graduateStudent(user, id, {
                transfer_to_customer_id: body.transfer_to_customer_id ?? null,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
