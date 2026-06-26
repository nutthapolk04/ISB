import type { HandlerContext } from "@/controllers/types";
import {
    listUsers,
    getUser,
    getUserPayerByUsername,
    getUserPayerByCard,
    familyLookup,
    createUser,
    updateUser,
    deleteUser,
} from "@/services/user_service";
import { handleServiceError } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

interface CallerWithShop {
    sub: string;
    username: string;
    roles: string[];
    is_superuser: boolean;
    shop_id?: string | null;
}

export const UserController = {
    list: async (ctx: any) => {
        const { query, user, set } = ctx;
        try {
            return await listUsers({
                caller: user as any,
                q: query.q,
                shopId: query.shop_id,
                role: query.role,
                unassigned: query.unassigned === "true",
                page: query.page ? Number(query.page) : undefined,
                pageSize: query.page_size ? Number(query.page_size) : undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    byUsername: async (ctx: any) => {
        const { params, set } = ctx;
        try {
            return await getUserPayerByUsername(params.username);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    byCard: async (ctx: any) => {
        const { params, set } = ctx;
        try {
            return await getUserPayerByCard(params.uid);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    familyLookup: async (ctx: any) => {
        const { query, set } = ctx;
        try {
            return await familyLookup(query.q);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    getById: async (ctx: any) => {
        const { params, user, set } = ctx;
        const id = parseIntParam(params.id, "user id", set);
        if (id === null) return { detail: "Invalid user id" };
        try {
            return await getUser(user as any, id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    create: async (ctx: any) => {
        const { body, user, set } = ctx;
        try {
            set.status = 201;
            return await createUser(user as any, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    update: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        const id = parseIntParam(params.id, "user id", set);
        if (id === null) return { detail: "Invalid user id" };
        try {
            return await updateUser(user as any, id, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    remove: async (ctx: any) => {
        const { params, user, set } = ctx;
        const id = parseIntParam(params.id, "user id", set);
        if (id === null) return { detail: "Invalid user id" };
        try {
            await deleteUser(user, id);
            set.status = 204;
            return null;
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
