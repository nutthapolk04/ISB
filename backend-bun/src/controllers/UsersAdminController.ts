import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import {
    listAdminUsers,
    listStaffForPicker,
    listStudentsForLink,
    getAdminUser,
    updateAdminUser,
    createStudent as createStudentUserAccount,
    getUserFamily,
    updateFamilyProfile,
    linkStudentToUser,
    unlinkStudent,
} from "@/services/user_admin_service";
import { adminOnly, handleServiceError } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

export const UsersAdminController = {
    list: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        return await listAdminUsers({
            role: query.role,
            q: query.q,
            status: query.status,
        });
    },

    staffPicker: async (ctx: any) => {
        const { query } = ctx;
        return await listStaffForPicker({ q: query.q, roles: query.roles });
    },

    listStudents: async (ctx: any) => {
        const { query, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        return await listStudentsForLink(query.q);
    },

    createStudent: async (ctx: any) => {
        const { body, user, set } = ctx;
        try {
            set.status = 201;
            return await createStudentUserAccount(user.roles, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    getById: async (ctx: any) => {
        const { params, user, set } = ctx;
        const id = parseIntParam(params.user_id, "user id", set);
        if (id === null) return { detail: "Invalid user id" };
        try {
            return await getAdminUser(user.roles, id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    update: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        const id = parseIntParam(params.user_id, "user id", set);
        if (id === null) return { detail: "Invalid user id" };
        try {
            return await updateAdminUser(user.roles, Number(user.sub), id, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    getFamily: async (ctx: any) => {
        const { params, user, set } = ctx;
        const id = parseIntParam(params.user_id, "user id", set);
        if (id === null) return { detail: "Invalid user id" };
        try {
            return await getUserFamily(user.roles, id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    updateFamilyProfile: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        try {
            return await updateFamilyProfile(user.roles, params.family_code, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    linkStudent: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        const id = parseIntParam(params.user_id, "user id", set);
        if (id === null) return { detail: "Invalid user id" };
        try {
            set.status = 201;
            return await linkStudentToUser(user.roles, id, body);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    unlinkStudent: async (ctx: any) => {
        const { params, user, set } = ctx;
        const userId = parseIntParam(params.user_id, "user id", set);
        const customerId = parseIntParam(params.customer_id, "customer id", set);
        if (userId === null || customerId === null) return { detail: "Invalid id" };
        try {
            return await unlinkStudent(user.roles, userId, customerId);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
