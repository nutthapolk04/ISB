import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import { closeDay } from "@/services/canteen_service";
import { scopeShop } from "@/services/report_service";
import { forbidden, handleServiceError } from "@/utils/ResponseUtil";

export const CanteenController = {
    closeDay: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager", "cashier")) {
            return forbidden(set);
        }
        try {
            const effective = scopeShop(user, params.shopId);
            if (!effective) {
                set.status = 403;
                return { detail: "Not authorized for that shop" };
            }
            return await closeDay(effective);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
