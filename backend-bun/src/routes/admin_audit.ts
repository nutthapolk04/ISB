import { Elysia, t } from "elysia";
import { requireAuth, hasRole } from "@/middleware/auth";
import { listAuditLogs } from "@/services/audit_log_service";

interface CallerWithShop {
  shop_id?: string | null;
}

export const adminAuditRoutes = new Elysia({ name: "admin-audit", prefix: "/admin" })
  .use(requireAuth)
  .get(
    "/audit-logs",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) {
        set.status = 403;
        return { detail: "Forbidden" };
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
    {
      query: t.Object({
        entity_type: t.Optional(t.String()),
        action: t.Optional(t.String()),
        user_id: t.Optional(t.String()),
        shop_id: t.Optional(t.String()),
        date_from: t.Optional(t.String()),
        date_to: t.Optional(t.String()),
        page: t.Optional(t.String()),
        page_size: t.Optional(t.String()),
      }),
      detail: { summary: "Paginated audit logs (admin sees all, non-admin pinned to own shop)" },
    },
  );
