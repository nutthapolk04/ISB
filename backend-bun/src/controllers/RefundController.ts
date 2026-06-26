/** Graduation refunds — candidates, family search/roster, create (auth: admin | refund_officer) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import { listRefundCandidates, createGraduationRefund } from "@/services/refund_service";
import { searchRefundFamilies, getRefundFamilyRoster } from "@/services/refund_family_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

const REFUND_ROLES = ["admin", "refund_officer"] as const;

export const RefundController = {
	candidates: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		if (!hasRole(user.roles, ...REFUND_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			return successResponse(reqContext, await listRefundCandidates(), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	familySearch: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { query } = reqContext;
		if (!hasRole(user.roles, ...REFUND_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			const q = query.q ?? "";
			const limit = query.limit ? Number(query.limit) : 10;
			const items = await searchRefundFamilies(q, limit);
			return successResponse(reqContext, { query: q, items }, ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	familyRoster: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, ...REFUND_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			const roster = await getRefundFamilyRoster(params.family_code);
			if (!roster) {
				return errorResponse(
					reqContext,
					`No members found for family_code '${params.family_code}'`,
					ResponseStatus.NOT_FOUND,
				);
			}
			return successResponse(reqContext, roster, ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	create: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, ...REFUND_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.customer_id, "customer id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await createGraduationRefund({
					customerId: id,
					amount: body.amount,
					method: body.method,
					notes: body.notes ?? null,
					userId: Number(user.sub),
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
