import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import {
    createTopupIntent,
    getTopupStatus,
    confirmTopup,
    userCanAccessWallet,
    inquireTopupFromGateway,
} from "@/services/topup_service";
import {
    cashierTopup,
    adjustDepartmentBalance,
    listDepartmentTransactions,
} from "@/services/wallet_service";
import { deleteDepartment } from "@/services/department_service";
import { handleServiceError, forbidden, adminOnly } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

const TOPUP_ROLES = ["parent", "staff", "admin", "cashier", "manager", "kitchen", "student", "kiosk"] as const;
const PARENT_CONFIRM_ROLES = ["parent", "staff", "kitchen", "student"] as const;

export const TopupController = {
    createIntent: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, ...TOPUP_ROLES)) return forbidden(set);
        const id = parseIntParam(params.id, "wallet id", set);
        if (id === null) return { detail: "Invalid wallet id" };
        try {
            if (!(await userCanAccessWallet(user, id))) {
                set.status = 403;
                return { detail: "Not authorized" };
            }
            return await createTopupIntent({
                walletId: id,
                amount: body.amount,
                userId: Number(user.sub),
                notes: body.notes ?? null,
                paymentMethod: body.payment_method ?? undefined,
                remark: body.remark ?? null,
                payType: body.pay_type ?? null,
                lang: body.lang ?? null,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    status: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, ...TOPUP_ROLES)) return forbidden(set);
        try {
            const { intent, walletId } = await getTopupStatus(params.refCode);
            if (!(await userCanAccessWallet(user, walletId))) {
                set.status = 403;
                return { detail: "Not authorized" };
            }
            return intent;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    parentConfirm: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, ...PARENT_CONFIRM_ROLES)) return forbidden(set);
        try {
            const { walletId } = await getTopupStatus(params.refCode);
            if (!(await userCanAccessWallet(user, walletId))) {
                set.status = 403;
                return { detail: "Not authorized" };
            }
            return await confirmTopup({
                refCode: params.refCode,
                confirmerId: Number(user.sub),
                confirmedVia: "parent_self",
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    inquiry: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, ...TOPUP_ROLES)) return forbidden(set);
        try {
            const { walletId } = await getTopupStatus(params.refCode);
            if (!(await userCanAccessWallet(user, walletId))) {
                set.status = 403;
                return { detail: "Not authorized" };
            }
            return await inquireTopupFromGateway(params.refCode);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    cashierTopup: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "cashier", "manager", "admin", "staff", "kiosk")) return forbidden(set);
        const id = parseIntParam(params.id, "wallet id", set);
        if (id === null) return { detail: "Invalid wallet id" };
        try {
            return await cashierTopup({
                walletId: id,
                amount: body.amount,
                cashierUserId: Number(user.sub),
                notes: body.notes ?? undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    adjustDepartment: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.department_id, "department id", set);
        if (id === null) return { detail: "Invalid department id" };
        try {
            return await adjustDepartmentBalance({
                departmentId: id,
                amount: body.amount,
                adminUserId: Number(user.sub),
                reason: body.reason,
                referenceTicket: body.reference_ticket ?? undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    departmentTransactions: async (ctx: any) => {
        const { params, query, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.department_id, "department id", set);
        if (id === null) return { detail: "Invalid department id" };
        try {
            return await listDepartmentTransactions({
                departmentId: id,
                limit: query.limit ? Number(query.limit) : undefined,
                dateFrom: query.date_from ?? undefined,
                dateTo: query.date_to ?? undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    deleteDepartment: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.department_id, "department id", set);
        if (id === null) return { detail: "Invalid department id" };
        try {
            await deleteDepartment(id);
            set.status = 204;
            return null;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
