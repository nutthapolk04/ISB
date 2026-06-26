import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import {
    getMyWallet,
    listFamilyWallets,
    getWallet,
    listTransactions,
    adjustBalance,
    transferWithinFamily,
} from "@/services/wallet_service";
import { handleServiceError, forbidden, adminOnly } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

import type { AccessTokenPayload } from "@/middleware/AuthUtils";

type WalletUser = AccessTokenPayload & { shop_id?: string | null; family_code?: string | null };

export const WalletController = {
    me: async (ctx: any) => {
        const { user, set } = ctx;
        try {
            return await getMyWallet(user);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    family: async (ctx: any) => {
        const { user, set } = ctx;
        if (!hasRole(user.roles, "parent", "staff", "cashier", "manager", "kitchen", "admin", "student")) {
            return forbidden(set);
        }
        try {
            return await listFamilyWallets(user);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    getById: async (ctx: any) => {
        const { params, user, set } = ctx;
        const id = parseIntParam(params.id, "wallet id", set);
        if (id === null) return { detail: "Invalid wallet id" };
        try {
            return await getWallet(user as WalletUser, id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    transactions: async (ctx: any) => {
        const { params, query, user, set } = ctx;
        const id = parseIntParam(params.id, "wallet id", set);
        if (id === null) return { detail: "Invalid wallet id" };
        try {
            return await listTransactions(
                user as WalletUser,
                id,
                query.date_from ?? undefined,
                query.date_to ?? undefined,
            );
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    adjust: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.id, "wallet id", set);
        if (id === null) return { detail: "Invalid wallet id" };
        try {
            return await adjustBalance({
                walletId: id,
                amount: body.amount,
                adminUserId: Number(user.sub),
                reason: body.reason,
                referenceTicket: body.reference_ticket ?? undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    transfer: async (ctx: any) => {
        const { body, user, set } = ctx;
        try {
            return await transferWithinFamily({
                fromWalletId: body.from_wallet_id,
                toWalletId: body.to_wallet_id,
                amount: body.amount,
                initiatorUserId: Number(user.sub),
                initiatorIsAdmin: hasRole(user.roles, "admin") || user.is_superuser,
                initiatorRoles: user.roles,
                note: body.note ?? undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
