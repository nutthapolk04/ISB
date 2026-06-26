import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import {
    listReturns,
    getReturnsByReceipt,
    getReturn,
    getReturnHistory,
    createReturn,
    createReturnWithoutReceipt,
    updateReturn,
    deleteReturn,
    processRefund,
    processExchange,
    searchReceipts,
    getExchangeProducts,
} from "@/services/returns_service";
import { handleServiceError, forbidden } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

import type { AccessTokenPayload } from "@/middleware/AuthUtils";

type ReturnUser = AccessTokenPayload & { shop_id?: string | null };

const RETURN_ROLES = ["admin", "manager", "cashier"] as const;

function shopScope(user: ReturnUser): string | null {
    return hasRole(user.roles, "admin") || user.is_superuser ? null : user.shop_id ?? null;
}

export const ReturnController = {
    list: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, ...RETURN_ROLES)) return forbidden(set);
        try {
            return await listReturns({
                q: query.filter ?? undefined,
                shopId: shopScope(user as ReturnUser),
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    byReceipt: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, ...RETURN_ROLES)) return forbidden(set);
        try {
            return await getReturnsByReceipt(query.receiptId, shopScope(user as ReturnUser));
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    getById: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, ...RETURN_ROLES)) return forbidden(set);
        const id = parseIntParam(params.id, "return id", set);
        if (id === null) return { detail: "Invalid return id" };
        try {
            return await getReturn(id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    history: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, ...RETURN_ROLES)) return forbidden(set);
        try {
            return await getReturnHistory({
                q: query.filter ?? undefined,
                shopId: shopScope(user as ReturnUser),
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    create: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!hasRole(user.roles, ...RETURN_ROLES)) return forbidden(set);
        try {
            return await createReturn({
                receiptId: body.receiptId,
                items: body.items as Parameters<typeof createReturn>[0]["items"],
                reason: body.reason,
                userId: Number(user.sub),
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    createWithoutReceipt: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!hasRole(user.roles, ...RETURN_ROLES)) return forbidden(set);
        try {
            return await createReturnWithoutReceipt({
                items: body.items as Parameters<typeof createReturnWithoutReceipt>[0]["items"],
                reason: body.reason,
                customerName: body.customerName ?? null,
                notes: body.notes ?? null,
                userId: Number(user.sub),
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    update: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, ...RETURN_ROLES)) return forbidden(set);
        const id = parseIntParam(params.id, "return id", set);
        if (id === null) return { detail: "Invalid return id" };
        try {
            return await updateReturn(id, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    remove: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, ...RETURN_ROLES)) return forbidden(set);
        const id = parseIntParam(params.id, "return id", set);
        if (id === null) return { detail: "Invalid return id" };
        try {
            await deleteReturn(id);
            return { success: true };
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    refund: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, ...RETURN_ROLES)) return forbidden(set);
        const id = parseIntParam(params.id, "return id", set);
        if (id === null) return { detail: "Invalid return id" };
        try {
            return await processRefund({
                returnId: id,
                reason: body.reason,
                notes: body.notes ?? null,
                userId: Number(user.sub),
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    exchange: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, ...RETURN_ROLES)) return forbidden(set);
        const id = parseIntParam(params.id, "return id", set);
        if (id === null) return { detail: "Invalid return id" };
        try {
            return await processExchange({
                returnId: id,
                exchangeItems: body.exchangeItems as Parameters<typeof processExchange>[0]["exchangeItems"],
                reason: body.reason,
                notes: body.notes ?? null,
                userId: Number(user.sub),
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    searchReceipts: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, ...RETURN_ROLES)) return forbidden(set);
        if (!query.receiptId && !query.studentCode && !query.dateFrom && !query.dateTo && !query.paymentMethod) {
            set.status = 400;
            return { detail: "At least one search criterion is required" };
        }
        try {
            const results = await searchReceipts({
                receiptId: query.receiptId ?? null,
                studentCode: query.studentCode ?? null,
                dateFrom: query.dateFrom ?? null,
                dateTo: query.dateTo ?? null,
                paymentMethod: query.paymentMethod ?? null,
                shopId: shopScope(user as ReturnUser),
            });
            if (results.length === 0) {
                set.status = 404;
                return { detail: "Receipt not found" };
            }
            return {
                receipts: results,
                receipt: results.length === 1 ? results[0] : null,
            };
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    exchangeProducts: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, ...RETURN_ROLES)) return forbidden(set);
        try {
            return await getExchangeProducts({
                shopId: query.shop_id ?? null,
                inStock: query.inStock !== "false",
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
