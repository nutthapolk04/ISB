import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import { buildTemplate, importProducts, importStockReceive, importStore } from "@/services/admin_import_service";
import { handleServiceError } from "@/utils/ResponseUtil";

import type { AccessTokenPayload } from "@/middleware/AuthUtils";

type ImportUser = AccessTokenPayload & { shop_id?: string | null };

const IMPORT_ROLES = ["admin", "manager"] as const;

export const AdminImportController = {
    template: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, ...IMPORT_ROLES)) {
            set.status = 403;
            return { detail: "Admin/manager only" };
        }
        try {
            return await buildTemplate(query.shop_id ?? "");
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    products: async (ctx: any) => {
        const { body, query, user, set } = ctx;
        if (!hasRole(user.roles, ...IMPORT_ROLES)) {
            set.status = 403;
            return { detail: "Admin/manager only" };
        }
        try {
            const result = await importProducts({
                caller: user as ImportUser,
                file: body.file,
                shopId: query.shop_id ?? "",
            });
            set.status = result.status;
            return result.body;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    stockReceive: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!hasRole(user.roles, ...IMPORT_ROLES)) {
            set.status = 403;
            return { detail: "Admin/manager only" };
        }
        try {
            const result = await importStockReceive({
                caller: user as ImportUser,
                file: body.file,
            });
            set.status = result.status;
            return result.body;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    store: async (ctx: any) => {
        const { body, query, user, set } = ctx;
        if (!hasRole(user.roles, ...IMPORT_ROLES)) {
            set.status = 403;
            return { detail: "Admin/manager only" };
        }
        try {
            const result = await importStore({
                caller: user as ImportUser,
                file: body.file,
                shopId: query.shop_id ?? "",
                dryRun: query.dry_run === "true",
            });
            set.status = result.status;
            return result.body;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
