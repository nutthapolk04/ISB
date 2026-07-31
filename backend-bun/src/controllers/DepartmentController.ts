/** Departments — GET /departments (auth) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { logger } from "@/logger";
import { listDepartments, getDepartmentByCard } from "@/services/department_service";
import { errorFromService, errorResponse, successResponse } from "@/utils/ResponseUtil";

export const DepartmentController = {
	list: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		logger.info(`[${reqContext.requestId} (DP-01)] DepartmentController.list() called.`);
		try {
			logger.info(`[${reqContext.requestId} (DP-01)] DepartmentController.list() calling listDepartments().`);
			const result = await listDepartments({
				q: query.q,
				activeOnly: query.active_only !== "false",
			});
			logger.info(`[${reqContext.requestId} (DP-01)] DepartmentController.list() completed.`);
			return successResponse(reqContext, result, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (DP-01)] DepartmentController.list() error:`, e);
			return errorFromService(reqContext, e);
		}
	},

	byCard: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { params } = reqContext;
		logger.info(`[${reqContext.requestId} (DP-02)] DepartmentController.byCard() called.`);
		try {
			const dept = await getDepartmentByCard(params.uid);
			if (!dept) {
				logger.warn(`[${reqContext.requestId} (DP-02)] DepartmentController.byCard() card not bound.`);
				return errorResponse(reqContext, "Card not bound", ResponseStatus.NOT_FOUND);
			}
			logger.info(`[${reqContext.requestId} (DP-02)] DepartmentController.byCard() completed.`);
			return successResponse(reqContext, dept, ResponseStatus.OK);
		} catch (e) {
			logger.error(`[${reqContext.requestId} (DP-02)] DepartmentController.byCard() error:`, e);
			return errorFromService(reqContext, e);
		}
	},
};
