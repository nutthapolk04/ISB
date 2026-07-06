/** Departments — GET /departments (auth) */
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { logger } from "@/logger";
import { listDepartments } from "@/services/department_service";
import { errorFromService, successResponse } from "@/utils/ResponseUtil";

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
};
