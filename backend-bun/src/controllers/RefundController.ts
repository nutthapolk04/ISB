/** Graduation refunds — candidates, family search/roster, create (auth: admin | refund_officer) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import { listRefundCandidates, createGraduationRefund } from "@/services/refund_service";
import { searchRefundFamilies, getRefundFamilyRoster } from "@/services/refund_family_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";
import { logger } from "@/logger";

const REFUND_ROLES = ["admin", "refund_officer"] as const;

export const RefundController = {
	candidates: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		logger.info(`[${reqContext.requestId} (RF-01)] RefundController.candidates() called.`);
		if (!hasRole(user.roles, ...REFUND_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RF-01)] RefundController.candidates() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (RF-01)] RefundController.candidates() calling listRefundCandidates().`);
			const result = await listRefundCandidates();
			logger.info(`[${reqContext.requestId} (RF-01)] RefundController.candidates() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RF-01)] RefundController.candidates() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	familySearch: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (RF-02)] RefundController.familySearch() called.`);
		if (!hasRole(user.roles, ...REFUND_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RF-02)] RefundController.familySearch() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			const q = query.q ?? "";
			const limit = query.limit ? Number(query.limit) : 10;
			logger.info(`[${reqContext.requestId} (RF-02)] RefundController.familySearch() calling searchRefundFamilies().`);
			const items = await searchRefundFamilies(q, limit);
			logger.info(`[${reqContext.requestId} (RF-02)] RefundController.familySearch() completed.`);
			return successResponse(reqContext, { query: q, items }, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RF-02)] RefundController.familySearch() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	familyRoster: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (RF-03)] RefundController.familyRoster() called.`);
		if (!hasRole(user.roles, ...REFUND_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RF-03)] RefundController.familyRoster() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (RF-03)] RefundController.familyRoster() calling getRefundFamilyRoster().`);
			const roster = await getRefundFamilyRoster(params.family_code);
			if (!roster) {
				logger.warn(`[${reqContext.requestId} (RF-03)] RefundController.familyRoster() family not found.`);
				return errorResponse(
					reqContext,
					`No members found for family_code '${params.family_code}'`,
					ResponseStatus.NOT_FOUND,
				);
			}
			logger.info(`[${reqContext.requestId} (RF-03)] RefundController.familyRoster() completed.`);
			return successResponse(reqContext, roster, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RF-03)] RefundController.familyRoster() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (RF-04)] RefundController.create() called.`);
		if (!hasRole(user.roles, ...REFUND_ROLES)) {
			logger.warn(`[${reqContext.requestId} (RF-04)] RefundController.create() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.customer_id, "customer id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (RF-04)] RefundController.create() invalid customer id.`);
			return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (RF-04)] RefundController.create() calling createGraduationRefund().`);
			const result = await createGraduationRefund({
				customerId: id,
				amount: body.amount,
				method: body.method,
				notes: body.notes ?? null,
				userId: Number(user.sub),
				idempotencyKey: body.idempotency_key,
			});
			logger.info(`[${reqContext.requestId} (RF-04)] RefundController.create() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (RF-04)] RefundController.create() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
