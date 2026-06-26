/** Departments — GET /departments (auth) */
import type { Context } from "elysia";
import { authedCtx } from "@/interfaces/ServiceRequest";
import ResponseStatus from "@/constants/ResponseStatus";
import { listDepartments } from "@/services/department_service";
import { errorFromService, successResponse } from "@/utils/ResponseUtil";

export const DepartmentController = {
	list: async (ctx: any) => {
		const { reqContext } = authedCtx(ctx);
		const { query } = reqContext;
		try {
			return successResponse(
				reqContext,
				await listDepartments({
					q: query.q,
					activeOnly: query.active_only !== "false",
				}),
				ResponseStatus.OK,
			);
		} catch (e) {
			return errorFromService(reqContext, e);
		}
	},
};
