/** Wallet top-ups, department adjust/transactions (auth; roles per action) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { hasRole } from "@/middleware/AuthMiddleware";
import {
	createTopupIntent,
	cancelTopupIntent,
	getTopupStatus,
	confirmTopup,
	userCanAccessWallet,
	inquireTopupFromGateway,
	reconcilePendingTopups,
} from "@/services/topup_service";
import {
	cashierTopup,
	cashierTopupByCustomer,
	cashierTopupByUser,
	adjustDepartmentBalance,
	listDepartmentTransactions,
} from "@/services/wallet_service";
import { deleteDepartment, updateDepartment } from "@/services/department_service";
import { parseIntParam } from "@/utils/ControllerValidatorUtils";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";
import { logger } from "@/logger";

const TOPUP_ROLES = ["parent", "staff", "admin", "cashier", "manager", "kitchen", "student", "kiosk"] as const;
const PARENT_CONFIRM_ROLES = ["parent", "staff", "kitchen", "student"] as const;

export const TopupController = {
	createIntent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (TP-01)] TopupController.createIntent() called.`);
		if (!hasRole(user.roles, ...TOPUP_ROLES)) {
			logger.warn(`[${reqContext.requestId} (TP-01)] TopupController.createIntent() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "wallet id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (TP-01)] TopupController.createIntent() invalid wallet id.`);
			return errorResponse(reqContext, "Invalid wallet id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			if (!(await userCanAccessWallet(user, id))) {
				logger.warn(`[${reqContext.requestId} (TP-01)] TopupController.createIntent() not authorized.`);
				return errorResponse(reqContext, "Not authorized", ResponseStatus.FORBIDDEN);
			}
			logger.info(`[${reqContext.requestId} (TP-01)] TopupController.createIntent() calling createTopupIntent().`);
			const result = await createTopupIntent({
				walletId: id,
				amount: body.amount,
				userId: Number(user.sub),
				notes: body.notes ?? null,
				paymentMethod: body.payment_method ?? undefined,
				remark: body.remark ?? null,
				payType: body.pay_type ?? null,
				lang: body.lang ?? null,
				actingUserId: hasRole(user.roles, "kiosk") && body.acting_user_id != null ? Number(body.acting_user_id) : undefined,
				actingCustomerId: hasRole(user.roles, "kiosk") && body.acting_customer_id != null ? Number(body.acting_customer_id) : undefined,
			});
			logger.info(`[${reqContext.requestId} (TP-01)] TopupController.createIntent() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (TP-01)] TopupController.createIntent() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	status: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (TP-02)] TopupController.status() called.`);
		if (!hasRole(user.roles, ...TOPUP_ROLES)) {
			logger.warn(`[${reqContext.requestId} (TP-02)] TopupController.status() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (TP-02)] TopupController.status() calling getTopupStatus().`);
			const { intent, walletId } = await getTopupStatus(params.refCode);
			if (!(await userCanAccessWallet(user, walletId))) {
				logger.warn(`[${reqContext.requestId} (TP-02)] TopupController.status() not authorized.`);
				return errorResponse(reqContext, "Not authorized", ResponseStatus.FORBIDDEN);
			}
			logger.info(`[${reqContext.requestId} (TP-02)] TopupController.status() completed.`);
			return successResponse(reqContext, intent, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (TP-02)] TopupController.status() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	parentConfirm: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (TP-03)] TopupController.parentConfirm() called.`);
		if (!hasRole(user.roles, ...PARENT_CONFIRM_ROLES)) {
			logger.warn(`[${reqContext.requestId} (TP-03)] TopupController.parentConfirm() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (TP-03)] TopupController.parentConfirm() calling getTopupStatus().`);
			const { walletId } = await getTopupStatus(params.refCode);
			if (!(await userCanAccessWallet(user, walletId))) {
				logger.warn(`[${reqContext.requestId} (TP-03)] TopupController.parentConfirm() not authorized.`);
				return errorResponse(reqContext, "Not authorized", ResponseStatus.FORBIDDEN);
			}
			logger.info(`[${reqContext.requestId} (TP-03)] TopupController.parentConfirm() calling confirmTopup().`);
			const result = await confirmTopup({
				refCode: params.refCode,
				confirmerId: Number(user.sub),
				confirmedVia: "parent_self",
			});
			logger.info(`[${reqContext.requestId} (TP-03)] TopupController.parentConfirm() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (TP-03)] TopupController.parentConfirm() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	inquiry: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (TP-04)] TopupController.inquiry() called.`);
		if (!hasRole(user.roles, ...TOPUP_ROLES)) {
			logger.warn(`[${reqContext.requestId} (TP-04)] TopupController.inquiry() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (TP-04)] TopupController.inquiry() calling getTopupStatus().`);
			const { walletId } = await getTopupStatus(params.refCode);
			if (!(await userCanAccessWallet(user, walletId))) {
				logger.warn(`[${reqContext.requestId} (TP-04)] TopupController.inquiry() not authorized.`);
				return errorResponse(reqContext, "Not authorized", ResponseStatus.FORBIDDEN);
			}
			logger.info(`[${reqContext.requestId} (TP-04)] TopupController.inquiry() calling inquireTopupFromGateway().`);
			const result = await inquireTopupFromGateway(params.refCode);
			logger.info(`[${reqContext.requestId} (TP-04)] TopupController.inquiry() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (TP-04)] TopupController.inquiry() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	cancelIntent: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (TP-06)] TopupController.cancelIntent() called.`);
		if (!hasRole(user.roles, ...TOPUP_ROLES)) {
			logger.warn(`[${reqContext.requestId} (TP-06)] TopupController.cancelIntent() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		try {
			const { walletId } = await getTopupStatus(params.refCode);
			if (!(await userCanAccessWallet(user, walletId))) {
				logger.warn(`[${reqContext.requestId} (TP-06)] TopupController.cancelIntent() not authorized.`);
				return errorResponse(reqContext, "Not authorized", ResponseStatus.FORBIDDEN);
			}
			await cancelTopupIntent(params.refCode);
			logger.info(`[${reqContext.requestId} (TP-06)] TopupController.cancelIntent() completed.`);
			return successResponse(reqContext, { cancelled: true }, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (TP-06)] TopupController.cancelIntent() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	cashierTopup: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (TP-05)] TopupController.cashierTopup() called.`);
		if (!hasRole(user.roles, "cashier", "manager", "admin", "staff", "kiosk")) {
			logger.warn(`[${reqContext.requestId} (TP-05)] TopupController.cashierTopup() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.id, "wallet id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (TP-05)] TopupController.cashierTopup() invalid wallet id.`);
			return errorResponse(reqContext, "Invalid wallet id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (TP-05)] TopupController.cashierTopup() calling cashierTopup().`);
			const result = await cashierTopup({
				walletId: id,
				amount: body.amount,
				cashierUserId: Number(user.sub),
				notes: body.notes ?? undefined,
				idempotencyKey: body.idempotency_key ?? undefined,
				actingUserId: hasRole(user.roles, "kiosk") && body.acting_user_id != null ? Number(body.acting_user_id) : undefined,
				actingCustomerId: hasRole(user.roles, "kiosk") && body.acting_customer_id != null ? Number(body.acting_customer_id) : undefined,
			});
			logger.info(`[${reqContext.requestId} (TP-05)] TopupController.cashierTopup() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (TP-05)] TopupController.cashierTopup() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	cashierTopupByCustomer: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (TP-05b)] TopupController.cashierTopupByCustomer() called.`);
		if (!hasRole(user.roles, "cashier", "manager", "admin", "staff", "kiosk")) {
			logger.warn(`[${reqContext.requestId} (TP-05b)] TopupController.cashierTopupByCustomer() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const customerId = parseIntParam(params.id, "customer id", reqContext.set);
		if (customerId === null) {
			return errorResponse(reqContext, "Invalid customer id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			const result = await cashierTopupByCustomer({
				customerId,
				amount: body.amount,
				cashierUserId: Number(user.sub),
				notes: body.notes ?? undefined,
			});
			logger.info(`[${reqContext.requestId} (TP-05b)] TopupController.cashierTopupByCustomer() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (TP-05b)] TopupController.cashierTopupByCustomer() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	cashierTopupByUser: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (TP-05c)] TopupController.cashierTopupByUser() called.`);
		if (!hasRole(user.roles, "cashier", "manager", "admin", "staff", "kiosk")) {
			logger.warn(`[${reqContext.requestId} (TP-05c)] TopupController.cashierTopupByUser() forbidden.`);
			return errorResponse(reqContext, "Forbidden", ResponseStatus.FORBIDDEN);
		}
		const userId = parseIntParam(params.id, "user id", reqContext.set);
		if (userId === null) {
			return errorResponse(reqContext, "Invalid user id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			const result = await cashierTopupByUser({
				userId,
				amount: body.amount,
				cashierUserId: Number(user.sub),
				notes: body.notes ?? undefined,
			});
			logger.info(`[${reqContext.requestId} (TP-05c)] TopupController.cashierTopupByUser() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (TP-05c)] TopupController.cashierTopupByUser() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	adjustDepartment: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (TP-06)] TopupController.adjustDepartment() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (TP-06)] TopupController.adjustDepartment() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.department_id, "department id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (TP-06)] TopupController.adjustDepartment() invalid department id.`);
			return errorResponse(reqContext, "Invalid department id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (TP-06)] TopupController.adjustDepartment() calling adjustDepartmentBalance().`);
			const result = await adjustDepartmentBalance({
				departmentId: id,
				amount: body.amount,
				adminUserId: Number(user.sub),
				reason: body.reason,
				referenceTicket: body.reference_ticket ?? undefined,
			});
			logger.info(`[${reqContext.requestId} (TP-06)] TopupController.adjustDepartment() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (TP-06)] TopupController.adjustDepartment() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	departmentTransactions: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, query } = reqContext;
		logger.info(`[${reqContext.requestId} (TP-07)] TopupController.departmentTransactions() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (TP-07)] TopupController.departmentTransactions() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.department_id, "department id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (TP-07)] TopupController.departmentTransactions() invalid department id.`);
			return errorResponse(reqContext, "Invalid department id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (TP-07)] TopupController.departmentTransactions() calling listDepartmentTransactions().`);
			const result = await listDepartmentTransactions({
				departmentId: id,
				limit: query.limit ? Number(query.limit) : undefined,
				dateFrom: query.date_from ?? undefined,
				dateTo: query.date_to ?? undefined,
			});
			logger.info(`[${reqContext.requestId} (TP-07)] TopupController.departmentTransactions() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (TP-07)] TopupController.departmentTransactions() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	updateDepartment: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params, body } = reqContext;
		logger.info(`[${reqContext.requestId} (TP-09)] TopupController.updateDepartment() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (TP-09)] TopupController.updateDepartment() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.department_id, "department id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (TP-09)] TopupController.updateDepartment() invalid department id.`);
			return errorResponse(reqContext, "Invalid department id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (TP-09)] TopupController.updateDepartment() calling updateDepartment().`);
			const result = await updateDepartment(id, {
				department_name: body.department_name,
				is_active: body.is_active,
			});
			logger.info(`[${reqContext.requestId} (TP-09)] TopupController.updateDepartment() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (TP-09)] TopupController.updateDepartment() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	/**
	 * Damage-control net for the created_by=null hotfix: scans pending
	 * top-up intents older than a threshold, inquires BAY directly, and
	 * credits anything the gateway confirms COMPLETED. dry_run defaults to
	 * TRUE so the first call is a damage assessment, not a mutation.
	 */
	reconcile: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { body } = reqContext;
		logger.info(`[${reqContext.requestId} (TP-10)] TopupController.reconcile() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (TP-10)] TopupController.reconcile() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		try {
			logger.info(`[${reqContext.requestId} (TP-10)] TopupController.reconcile() calling reconcilePendingTopups().`);
			const result = await reconcilePendingTopups({
				olderThanMinutes: body?.older_than_minutes ?? undefined,
				limit: body?.limit ?? undefined,
				dryRun: body?.dry_run ?? true,
			});
			logger.info(
				`[${reqContext.requestId} (TP-10)] TopupController.reconcile() completed. ` +
				`dryRun=${result.dry_run} scanned=${result.scanned} credited=${result.credited.length} failed=${result.failed.length} skipped=${result.skipped.length}`,
			);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (TP-10)] TopupController.reconcile() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	deleteDepartment: async (ctx: any) => {
		const { reqContext, user } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (TP-08)] TopupController.deleteDepartment() called.`);
		if (!hasRole(user.roles, "admin")) {
			logger.warn(`[${reqContext.requestId} (TP-08)] TopupController.deleteDepartment() forbidden.`);
			return errorResponse(reqContext, "Admin only", ResponseStatus.FORBIDDEN);
		}
		const id = parseIntParam(params.department_id, "department id", reqContext.set);
		if (id === null) {
			logger.warn(`[${reqContext.requestId} (TP-08)] TopupController.deleteDepartment() invalid department id.`);
			return errorResponse(reqContext, "Invalid department id", ResponseStatus.UNPROCESSABLE);
		}
		try {
			logger.info(`[${reqContext.requestId} (TP-08)] TopupController.deleteDepartment() calling deleteDepartment().`);
			await deleteDepartment(id);
			logger.info(`[${reqContext.requestId} (TP-08)] TopupController.deleteDepartment() completed.`);
			return successResponse(reqContext, undefined, ResponseStatus.NO_CONTENT);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (TP-08)] TopupController.deleteDepartment() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
