import type { HandlerContext } from "@/controllers/types";
import { listDepartments } from "@/services/department_service";
import { handleServiceError } from "@/utils/ResponseUtil";

export const DepartmentController = {
    list: async (ctx: any) => {
        const { query, set } = ctx;
        try {
            return await listDepartments({
                q: query.q,
                activeOnly: query.active_only !== "false",
            });
        } catch (e) {
            return handleServiceError(set)(e);
        }
    },
};
