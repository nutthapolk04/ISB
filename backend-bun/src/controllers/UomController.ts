import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import {
    listUoms,
    getUom,
    createUom,
    updateUom,
    deleteUom,
    seedDefaultUoms,
} from "@/services/uom_service";
import { handleServiceError, forbidden, adminOnly } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

export const UomController = {
    list: async (ctx: any) => {
        const { query, set } = ctx;
        try {
            return await listUoms(query.active_only !== "false");
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    getById: async (ctx: any) => {
        const { params, set } = ctx;
        const id = parseIntParam(params.id, "id", set);
        if (id === null) return { detail: "Invalid id" };
        try {
            return await getUom(id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    create: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return forbidden(set);
        try {
            set.status = 201;
            return await createUom({
                ...body,
                name_en: body.name_en ?? undefined,
                base_uom_id: body.base_uom_id ?? undefined,
                conversion_factor: body.conversion_factor ?? undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    update: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) return forbidden(set);
        const id = parseIntParam(params.id, "id", set);
        if (id === null) return { detail: "Invalid id" };
        try {
            return await updateUom(id, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    remove: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.id, "id", set);
        if (id === null) return { detail: "Invalid id" };
        try {
            return await deleteUom(id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    seedDefaults: async (ctx: any) => {
        const { user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        try {
            return await seedDefaultUoms();
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
