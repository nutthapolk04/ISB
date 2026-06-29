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
import { logger } from "@/logger";

type FamilyUser = AccessTokenPayload & { family_code?: string | null };

const FAMILY_READ_ROLES = ["parent", "staff", "cashier", "manager", "kitchen", "admin"] as const;

export const FamilyController = {
	me: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		logger.info(`[${reqContext.requestId} (FA-01)] FamilyController.me() called.`);
		if (!hasRole(user.roles, ...FAMILY_READ_ROLES)) {
			logger.warn(`[${reqContext.requestId} (FA-01)] FamilyController.me() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (FA-01)] FamilyController.me() calling myChildren().`);
			const result = await myChildren(Number(user.sub));
			logger.info(`[${reqContext.requestId} (FA-01)] FamilyController.me() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (FA-01)] FamilyController.me() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	coparents: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		logger.info(`[${reqContext.requestId} (FA-02)] FamilyController.coparents() called.`);
		if (!hasRole(user.roles, ...FAMILY_READ_ROLES)) {
			logger.warn(`[${reqContext.requestId} (FA-02)] FamilyController.coparents() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const familyCode = (user as FamilyUser).family_code ?? null;
		try {
			logger.info(`[${reqContext.requestId} (FA-02)] FamilyController.coparents() calling myCoparents().`);
			const result = await myCoparents(Number(user.sub), familyCode);
			logger.info(`[${reqContext.requestId} (FA-02)] FamilyController.coparents() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (FA-02)] FamilyController.coparents() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	getLowBalanceAlert: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (FA-03)] FamilyController.getLowBalanceAlert() called.`);
		if (!hasRole(user.roles, ...FAMILY_READ_ROLES)) {
			logger.warn(`[${reqContext.requestId} (FA-03)] FamilyController.getLowBalanceAlert() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.child_id, "child id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (FA-03)] FamilyController.getLowBalanceAlert() invalid child id.`);
			return errorResponse(reqContext, "Invalid child id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (FA-03)] FamilyController.getLowBalanceAlert() calling getLowBalanceAlert().`);
			const result = await getLowBalanceAlert(Number(user.sub), id);
			logger.info(`[${reqContext.requestId} (FA-03)] FamilyController.getLowBalanceAlert() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (FA-03)] FamilyController.getLowBalanceAlert() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	updateLowBalanceAlert: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (FA-04)] FamilyController.updateLowBalanceAlert() called.`);
		if (!hasRole(user.roles, ...FAMILY_READ_ROLES)) {
			logger.warn(`[${reqContext.requestId} (FA-04)] FamilyController.updateLowBalanceAlert() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.child_id, "child id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (FA-04)] FamilyController.updateLowBalanceAlert() invalid child id.`);
			return errorResponse(reqContext, "Invalid child id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (FA-04)] FamilyController.updateLowBalanceAlert() calling updateLowBalanceAlert().`);
			const result = await updateLowBalanceAlert({
				parentUserId: Number(user.sub),
				childId: id,
				enabled: body.enabled,
				threshold: body.threshold ?? null,
			});
			logger.info(`[${reqContext.requestId} (FA-04)] FamilyController.updateLowBalanceAlert() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (FA-04)] FamilyController.updateLowBalanceAlert() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	context: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (FA-05)] FamilyController.context() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (FA-05)] FamilyController.context() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (FA-05)] FamilyController.context() calling studentFamilyContext().`);
			const result = await studentFamilyContext(params.student_code);
			logger.info(`[${reqContext.requestId} (FA-05)] FamilyController.context() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (FA-05)] FamilyController.context() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	byUser: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (FA-06)] FamilyController.byUser() called.`);
		if (!hasRole(user.roles, "admin", "kiosk")) {
			logger.warn(`[${reqContext.requestId} (FA-06)] FamilyController.byUser() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.user_id, "user id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (FA-06)] FamilyController.byUser() invalid user id.`);
			return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (FA-06)] FamilyController.byUser() calling familyByUserId().`);
			const result = await familyByUserId(id);
			logger.info(`[${reqContext.requestId} (FA-06)] FamilyController.byUser() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (FA-06)] FamilyController.byUser() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	listLinks: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		logger.info(`[${reqContext.requestId} (FA-07)] FamilyController.listLinks() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (FA-07)] FamilyController.listLinks() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (FA-07)] FamilyController.listLinks() calling listLinks().`);
			const result = await listLinks();
			logger.info(`[${reqContext.requestId} (FA-07)] FamilyController.listLinks() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (FA-07)] FamilyController.listLinks() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	createLink: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (FA-08)] FamilyController.createLink() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (FA-08)] FamilyController.createLink() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (FA-08)] FamilyController.createLink() calling createLink().`);
			const result = await createLink({
				parentUserId: body.parent_user_id,
				childCustomerId: body.child_customer_id,
				relation: body.relation ?? undefined,
			});
			logger.info(`[${reqContext.requestId} (FA-08)] FamilyController.createLink() completed.`);
			return successResponse(reqContext, result, ResponseStatus.CREATED);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (FA-08)] FamilyController.createLink() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	deleteLink: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (FA-09)] FamilyController.deleteLink() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (FA-09)] FamilyController.deleteLink() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.link_id, "link id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (FA-09)] FamilyController.deleteLink() invalid link id.`);
			return errorResponse(reqContext, "Invalid link id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (FA-09)] FamilyController.deleteLink() calling deleteLink().`);
			const result = await deleteLink(id);
			logger.info(`[${reqContext.requestId} (FA-09)] FamilyController.deleteLink() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (FA-09)] FamilyController.deleteLink() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	freezeAll: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (FA-10)] FamilyController.freezeAll() called.`);
		if (!hasRole(user.roles, "admin", "parent", "staff", "cashier", "manager", "kitchen")) {
			logger.warn(`[${reqContext.requestId} (FA-10)] FamilyController.freezeAll() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (FA-10)] FamilyController.freezeAll() calling freezeAllChildren().`);
			const result = await freezeAllChildren({
				caller: { id: Number(user.sub), isAdmin: hasRole(user.roles, "admin") || user.is_superuser },
				parentUserId: body.parent_user_id,
				frozen: body.frozen,
			});
			logger.info(`[${reqContext.requestId} (FA-10)] FamilyController.freezeAll() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (FA-10)] FamilyController.freezeAll() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	orphans: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		logger.info(`[${reqContext.requestId} (FA-11)] FamilyController.orphans() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (FA-11)] FamilyController.orphans() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (FA-11)] FamilyController.orphans() calling listOrphans().`);
			const result = await listOrphans();
			logger.info(`[${reqContext.requestId} (FA-11)] FamilyController.orphans() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (FA-11)] FamilyController.orphans() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
