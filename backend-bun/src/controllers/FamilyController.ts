/** Family portal — children, links, alerts, freeze-all (auth; admin for links) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";
import { hasRole } from "@/middleware/AuthMiddleware";
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
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

type FamilyUser = AccessTokenPayload & { family_code?: string | null };

const FAMILY_READ_ROLES = ["parent", "staff", "cashier", "manager", "kitchen", "admin"] as const;

export const FamilyController = {
	me: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		if (!hasRole(user.roles, ...FAMILY_READ_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(reqContext, await myChildren(Number(user.sub)), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	coparents: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		if (!hasRole(user.roles, ...FAMILY_READ_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const familyCode = (user as FamilyUser).family_code ?? null;
		try {
			return successResponse(reqContext, await myCoparents(Number(user.sub), familyCode), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	getLowBalanceAlert: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, ...FAMILY_READ_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.child_id, "child id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid child id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await getLowBalanceAlert(Number(user.sub), id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	updateLowBalanceAlert: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, ...FAMILY_READ_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.child_id, "child id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid child id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await updateLowBalanceAlert({
					parentUserId: Number(user.sub),
					childId: id,
					enabled: body.enabled,
					threshold: body.threshold ?? null,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	context: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(reqContext, await studentFamilyContext(params.student_code), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	byUser: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin", "kiosk")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await familyByUserId(id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	listLinks: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(reqContext, await listLinks(), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	createLink: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await createLink({
					parentUserId: body.parent_user_id,
					childCustomerId: body.child_customer_id,
					relation: body.relation ?? undefined,
				}),
				ResponseStatus.CREATED,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	deleteLink: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.link_id, "link id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid link id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(reqContext, await deleteLink(id), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	freezeAll: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		if (!hasRole(user.roles, "admin", "parent", "staff", "cashier", "manager", "kitchen")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(
				reqContext,
				await freezeAllChildren({
					caller: { id: Number(user.sub), isAdmin: hasRole(user.roles, "admin") || user.is_superuser },
					parentUserId: body.parent_user_id,
					frozen: body.frozen,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	orphans: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(reqContext, await listOrphans(), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
