import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import {
    myChildren,
    myCoparents,
    getLowBalanceAlert,
    studentFamilyContext,
    familyByUserId,
    updateLowBalanceAlert,
    listLinks,
    createLink,
    deleteLink,
    freezeAllChildren,
    listOrphans,
} from "@/services/family_service";
import { handleServiceError, forbidden, adminOnly } from "@/utils/ResponseUtil";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";

import type { AccessTokenPayload } from "@/middleware/AuthUtils";

type FamilyUser = AccessTokenPayload & { family_code?: string | null };

const FAMILY_READ_ROLES = ["parent", "staff", "cashier", "manager", "kitchen", "admin"] as const;

export const FamilyController = {
    me: async (ctx: any) => {
        const { user, set } = ctx;
        if (!hasRole(user.roles, ...FAMILY_READ_ROLES)) return forbidden(set);
        try {
            return await myChildren(Number(user.sub));
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    coparents: async (ctx: any) => {
        const { user, set } = ctx;
        if (!hasRole(user.roles, ...FAMILY_READ_ROLES)) return forbidden(set);
        const familyCode = (user as FamilyUser).family_code ?? null;
        try {
            return await myCoparents(Number(user.sub), familyCode);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    getLowBalanceAlert: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, ...FAMILY_READ_ROLES)) return forbidden(set);
        const id = parseIntParam(params.child_id, "child id", set);
        if (id === null) return { detail: "Invalid child id" };
        try {
            return await getLowBalanceAlert(Number(user.sub), id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    updateLowBalanceAlert: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, ...FAMILY_READ_ROLES)) return forbidden(set);
        const id = parseIntParam(params.child_id, "child id", set);
        if (id === null) return { detail: "Invalid child id" };
        try {
            return await updateLowBalanceAlert({
                parentUserId: Number(user.sub),
                childId: id,
                enabled: body.enabled,
                threshold: body.threshold ?? null,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    context: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        try {
            return await studentFamilyContext(params.student_code);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    byUser: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "kiosk")) return forbidden(set);
        const id = parseIntParam(params.user_id, "user id", set);
        if (id === null) return { detail: "Invalid user id" };
        try {
            return await familyByUserId(id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    listLinks: async (ctx: any) => {
        const { user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        try {
            return await listLinks();
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    createLink: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        try {
            set.status = 201;
            return await createLink({
                parentUserId: body.parent_user_id,
                childCustomerId: body.child_customer_id,
                relation: body.relation ?? undefined,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    deleteLink: async (ctx: any) => {
        const { params, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const id = parseIntParam(params.link_id, "link id", set);
        if (id === null) return { detail: "Invalid link id" };
        try {
            return await deleteLink(id);
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    freezeAll: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "parent", "staff", "cashier", "manager", "kitchen")) {
            return forbidden(set);
        }
        try {
            return await freezeAllChildren({
                caller: { id: Number(user.sub), isAdmin: hasRole(user.roles, "admin") || user.is_superuser },
                parentUserId: body.parent_user_id,
                frozen: body.frozen,
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },

    orphans: async (ctx: any) => {
        const { user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        try {
            return await listOrphans();
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
