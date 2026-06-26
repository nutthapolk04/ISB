import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import { listCardholders, createCardholder } from "@/services/cardholder_service";
import { handleServiceError, forbidden } from "@/utils/ResponseUtil";

export const CardholderController = {
    list: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return forbidden(set);
        const page = query.page ? Math.max(Number(query.page), 1) : 1;
        const pageSize = query.page_size ? Math.min(Math.max(Number(query.page_size), 1), 500) : 50;
        try {
            return await listCardholders({ kind: query.kind ?? null, q: query.q ?? null, page, pageSize });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    create: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return forbidden(set);
        try {
            set.status = 201;
            return await createCardholder(body as Parameters<typeof createCardholder>[0]);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
