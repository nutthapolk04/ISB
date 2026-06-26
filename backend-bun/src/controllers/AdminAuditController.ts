import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import { listAuditLogs } from "@/services/audit_log_service";
import { forbidden } from "@/utils/ResponseUtil";

interface CallerWithShop {
	shop_id?: string | null;
}

export const AdminAuditController = {
	listAuditLogs: async (ctx: any) => {
		const { query, user, set } = ctx;
		if (!hasRole(user.roles, "admin", "manager", "cashier")) {
			return forbidden(set);
		}
		const callerIsAdmin = hasRole(user.roles, "admin") || user.is_superuser;
		const caller = user as unknown as CallerWithShop;
		return await listAuditLogs({
			entityType: query.entity_type,
			action: query.action,
			userId: query.user_id ? Number(query.user_id) : undefined,
			shopId: query.shop_id,
			dateFrom: query.date_from,
			dateTo: query.date_to,
			page: query.page ? Number(query.page) : undefined,
			pageSize: query.page_size ? Number(query.page_size) : undefined,
			callerIsAdmin,
			callerShopId: caller.shop_id ?? null,
		});
	},
};
