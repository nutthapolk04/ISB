import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import {
    listImages,
    getImageBinary,
    reorderImages,
    deleteImage,
    uploadImage,
} from "@/services/customer_display_service";
import { handleServiceError, adminOnly } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

export const CustomerDisplayController = {
    listPublic: async () => {
        return await listImages();
    },

    getBinary: async (ctx: any) => {
        const { params, set } = ctx;
        const id = parseIntParam(params.id, "id", set);
        if (id === null) return { detail: "Invalid id" };
        try {
            const bin = await getImageBinary(id);
            set.headers["Content-Type"] = bin.contentType;
            set.headers["Cache-Control"] = "public, max-age=3600";
            set.headers["Content-Length"] = String(bin.sizeBytes);
            return bin.content;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    upload: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        try {
            const f = (body as { file?: File }).file;
            if (!f) {
                set.status = 422;
                return { detail: "file is required" };
            }
            set.status = 201;
            return await uploadImage({ file: f, userId: Number(user.sub) });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    delete: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.id, "id", set);
        if (id === null) return { detail: "Invalid id" };
        try {
            await deleteImage(id);
            set.status = 204;
            return null;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    reorder: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        try {
            return await reorderImages(body.ordered_ids);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
