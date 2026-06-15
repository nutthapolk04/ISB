import { Elysia, t } from "elysia";
import { requireAuth, hasRole } from "@/middleware/auth";
import {
  listAdminUsers,
  listStaffForPicker,
  listStudentsForLink,
} from "@/services/user_admin_service";

export const usersAdminRoutes = new Elysia({ name: "users-admin", prefix: "/users-admin" })
  .use(requireAuth)
  .get(
    "/",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin")) {
        set.status = 403;
        return { detail: "Admin only" };
      }
      return await listAdminUsers({
        role: query.role,
        q: query.q,
        status: query.status,
      });
    },
    {
      query: t.Object({
        role: t.Optional(t.Nullable(t.String())),
        q: t.Optional(t.Nullable(t.String())),
        status: t.Optional(t.Nullable(t.String())),
      }),
      detail: { summary: "Admin user list with has_children + shop_name enrichment" },
    },
  )
  .get(
    "/staff-picker",
    async ({ query }) => {
      return await listStaffForPicker({ q: query.q, roles: query.roles });
    },
    {
      query: t.Object({
        q: t.Optional(t.Nullable(t.String())),
        roles: t.Optional(t.Nullable(t.String())),
      }),
      detail: { summary: "Compact staff list for the requisition requester picker" },
    },
  )
  .get(
    "/students",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin")) {
        set.status = 403;
        return { detail: "Admin only" };
      }
      return await listStudentsForLink(query.q);
    },
    {
      query: t.Object({ q: t.Optional(t.Nullable(t.String())) }),
      detail: { summary: "Customer rows with student_code set, for the Link Student picker" },
    },
  );
