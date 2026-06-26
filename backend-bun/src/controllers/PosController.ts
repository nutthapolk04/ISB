import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import { listReceipts, getReceipt, voidReceipt } from "@/services/pos_service";
import { checkout, type CheckoutInput } from "@/services/pos_checkout_service";
import {
    createPosQrIntent,
    getPosQrIntent,
    cancelPosQrIntent,
    confirmPosQrSale,
} from "@/services/pos_qr_service";
import { qrInquiry as bayQrInquiry } from "@/services/pymt_gateway";
import { handleServiceError, forbidden } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

import type { AccessTokenPayload } from "@/middleware/AuthUtils";

type PosUser = AccessTokenPayload & { shop_id?: string | null };

const POS_ROLES = ["cashier", "manager", "admin", "kiosk"] as const;

export const PosController = {
    listReceipts: async (ctx: any) => {
        const { query, user, set } = ctx;
        try {
            return await listReceipts({
                caller: user as PosUser,
                q: query.q ?? undefined,
                shopId: query.shop_id ?? undefined,
                shopIds: query.shop_ids ?? undefined,
                transactionMode: query.transaction_mode ?? undefined,
                requesterUserId: query.requester_user_id ? Number(query.requester_user_id) : undefined,
                dateFrom: query.date_from ?? undefined,
                dateTo: query.date_to ?? undefined,
                page: query.page ? Number(query.page) : undefined,
                pageSize: query.page_size ? Number(query.page_size) : undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    getReceipt: async (ctx: any) => {
        const { params, set } = ctx;
        const id = parseIntParam(params.id, "receipt id", set);
        if (id === null) return { detail: "Invalid receipt id" };
        try {
            return await getReceipt(id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    checkout: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!hasRole(user.roles, ...POS_ROLES)) return forbidden(set);
        try {
            return await checkout({ ...(body as Omit<CheckoutInput, "userId">), userId: Number(user.sub) });
        } catch (e) {
            const err = e as { status?: number; message?: string; code?: string };
            if (err.status && err.status >= 400 && err.status < 600) {
                set.status = err.status;
                return err.code
                    ? { detail: err.message ?? "Bad request", code: err.code }
                    : { detail: err.message ?? "Bad request" };
            }
            throw e;
        }
    },

    voidReceipt: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager", "cashier")) return forbidden(set);
        const id = parseIntParam(params.id, "receipt id", set);
        if (id === null) return { detail: "Invalid receipt id" };
        try {
            return await voidReceipt({
                caller: user as PosUser,
                receiptId: id,
                reason: body?.reason ?? null,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    createQrIntent: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!hasRole(user.roles, ...POS_ROLES)) return forbidden(set);
        try {
            return await createPosQrIntent({
                cart: { ...(body.cart as Omit<CheckoutInput, "payment_method">), userId: Number(user.sub) },
                cashierUserId: Number(user.sub),
                amount: body.amount,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    getQrIntentStatus: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, ...POS_ROLES)) return forbidden(set);
        try {
            return await getPosQrIntent(params.refCode);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    inquireQrIntent: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, ...POS_ROLES)) return forbidden(set);
        try {
            const local = await getPosQrIntent(params.refCode);
            if (local.status !== "pending" || !local.txn_no) return local;
            const inq = await bayQrInquiry({ transactionNo: local.txn_no });
            if (inq.status === "confirmed") {
                await confirmPosQrSale(params.refCode);
            } else if (inq.status === "cancelled") {
                await cancelPosQrIntent(params.refCode);
            }
            return await getPosQrIntent(params.refCode);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    cancelQrIntent: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, ...POS_ROLES)) return forbidden(set);
        try {
            await cancelPosQrIntent(params.refCode);
            return await getPosQrIntent(params.refCode);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
