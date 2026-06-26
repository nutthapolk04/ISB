import type { HandlerContext } from "@/controllers/types";
import {
    login as loginService,
    refresh as refreshService,
    logout as logoutService,
    me as meService,
    mockSso as mockSsoService,
    googleSso as googleSsoService,
    listUserRoles as listUserRolesService,
    assignRoleToUser,
    removeRoleFromUser,
} from "@/services/auth_service";
import { hasRole } from "@/middleware/AuthUtils";
import { handleServiceError, adminOnly } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

export const AuthController = {
    login: async (ctx: any) => {
        const { body, set } = ctx;
        try {
            return await loginService(body.username, body.password);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    refresh: async (ctx: any) => {
        const { body, set } = ctx;
        try {
            return await refreshService(body.refresh_token);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    mockSso: async (ctx: any) => {
        const { body, set } = ctx;
        try {
            return await mockSsoService(body.email);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    googleSso: async (ctx: any) => {
        const { body, set } = ctx;
        try {
            return await googleSsoService(body.access_token);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    logout: async (ctx: any) => {
        const { user, set } = ctx;
        await logoutService(Number(user.sub));
        set.status = 204;
        return null;
    },

    jwtMe: ({ user }: any) => ({
        sub: user.sub,
        username: user.username,
        roles: user.roles,
        is_superuser: user.is_superuser,
    }),

    me: async (ctx: any) => {
        const { user, set } = ctx;
        try {
            return await meService(Number(user.sub));
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    listUserRoles: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.user_id, "user id", set);
        if (id === null) return { detail: "Invalid user id" };
        try {
            return await listUserRolesService(id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    assignRole: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.user_id, "user id", set);
        if (id === null) return { detail: "Invalid user id" };
        try {
            set.status = 201;
            return await assignRoleToUser(id, body.role_name);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    removeRole: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.user_id, "user id", set);
        if (id === null) return { detail: "Invalid user id" };
        try {
            return await removeRoleFromUser(id, decodeURIComponent(params.role_name));
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
