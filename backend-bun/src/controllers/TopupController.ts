/** Wallet top-ups, department adjust/transactions (auth; roles per action) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import {
	createTopupIntent,
	getTopupStatus,
	confirmTopup,
	userCanAccessWallet,
	inquireTopupFromGateway,
} from "@/services/topup_service";
import {
	cashierTopup,
	adjustDepartmentBalance,
	listDepartmentTransactions,
} from "@/services/wallet_service";
import { deleteDepartment } from "@/services/department_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

const TOPUP_ROLES = ["parent", "staff", "admin", "cashier", "manager", "kitchen", "student", "kiosk"] as const;
const PARENT_CONFIRM_ROLES = ["parent", "staff", "kitchen", "student"] as const;

export const TopupController = {
	createIntent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, ...TOPUP_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "wallet id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid wallet id", ResponseStatus.UNPROCESSABLE);
		try {
			if (!(await userCanAccessWallet(user, id))) {
				return errorResponse(reqContext, "Not authorized", ResponseStatus.FORBIDDEN);
			}
			return successResponse(
				reqContext,
				await createTopupIntent({
					walletId: id,
					amount: body.amount,
					userId: Number(user.sub),
					notes: body.notes ?? null,
					paymentMethod: body.payment_method ?? undefined,
					remark: body.remark ?? null,
					payType: body.pay_type ?? null,
					lang: body.lang ?? null,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	status: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, ...TOPUP_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			const { intent, walletId } = await getTopupStatus(params.refCode);
			if (!(await userCanAccessWallet(user, walletId))) {
				return errorResponse(reqContext, "Not authorized", ResponseStatus.FORBIDDEN);
			}
			return successResponse(reqContext, intent, ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	parentConfirm: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, ...PARENT_CONFIRM_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			const { walletId } = await getTopupStatus(params.refCode);
			if (!(await userCanAccessWallet(user, walletId))) {
				return errorResponse(reqContext, "Not authorized", ResponseStatus.FORBIDDEN);
			}
			return successResponse(
				reqContext,
				await confirmTopup({
					refCode: params.refCode,
					confirmerId: Number(user.sub),
					confirmedVia: "parent_self",
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	inquiry: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, ...TOPUP_ROLES)) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			const { walletId } = await getTopupStatus(params.refCode);
			if (!(await userCanAccessWallet(user, walletId))) {
				return errorResponse(reqContext, "Not authorized", ResponseStatus.FORBIDDEN);
			}
			return successResponse(reqContext, await inquireTopupFromGateway(params.refCode), ResponseStatus.OK);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	cashierTopup: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "cashier", "manager", "admin", "staff", "kiosk")) {
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "wallet id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid wallet id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await cashierTopup({
					walletId: id,
					amount: body.amount,
					cashierUserId: Number(user.sub),
					notes: body.notes ?? undefined,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	adjustDepartment: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.department_id, "department id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid department id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await adjustDepartmentBalance({
					departmentId: id,
					amount: body.amount,
					adminUserId: Number(user.sub),
					reason: body.reason,
					referenceTicket: body.reference_ticket ?? undefined,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	departmentTransactions: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, query } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.department_id, "department id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid department id", ResponseStatus.UNPROCESSABLE);
		try {
			return successResponse(
				reqContext,
				await listDepartmentTransactions({
					departmentId: id,
					limit: query.limit ? Number(query.limit) : undefined,
					dateFrom: query.date_from ?? undefined,
					dateTo: query.date_to ?? undefined,
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},

	deleteDepartment: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		if (!hasRole(user.roles, "admin")) {
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.department_id, "department id", reqContext.set);
		if (id === null) return errorResponse(reqContext, "Invalid department id", ResponseStatus.UNPROCESSABLE);
		try {
			await deleteDepartment(id);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
