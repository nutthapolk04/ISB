import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import { listRefundCandidates, createGraduationRefund } from "@/services/refund_service";
import { searchRefundFamilies, getRefundFamilyRoster } from "@/services/refund_family_service";
import { handleServiceError, forbidden } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

const REFUND_ROLES = ["admin", "refund_officer"] as const;

export const RefundController = {
    candidates: async (ctx: any) => {
        const { user, set } = ctx;
        if (!hasRole(user.roles, ...REFUND_ROLES)) return forbidden(set);
        try {
            return await listRefundCandidates();
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    familySearch: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, ...REFUND_ROLES)) return forbidden(set);
        try {
            const q = query.q ?? "";
            const limit = query.limit ? Number(query.limit) : 10;
            const items = await searchRefundFamilies(q, limit);
            return { query: q, items };
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    familyRoster: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, ...REFUND_ROLES)) return forbidden(set);
        try {
            const roster = await getRefundFamilyRoster(params.family_code);
            if (!roster) {
                set.status = 404;
                return { detail: `No members found for family_code '${params.family_code}'` };
            }
            return roster;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    create: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, ...REFUND_ROLES)) return forbidden(set);
        const id = parseIntParam(params.customer_id, "customer id", set);
        if (id === null) return { detail: "Invalid customer id" };
        try {
            return await createGraduationRefund({
                customerId: id,
                amount: body.amount,
                method: body.method,
                notes: body.notes ?? null,
                userId: Number(user.sub),
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
