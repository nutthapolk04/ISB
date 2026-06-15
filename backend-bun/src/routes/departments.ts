import { Elysia, t } from "elysia";
import { requireAuth } from "@/middleware/auth";
import { listDepartments } from "@/services/department_service";

export const departmentRoutes = new Elysia({ prefix: "/api/v1/departments" })
  .use(requireAuth)
  .get(
    "/",
    async ({ query }) => {
      return await listDepartments({
        q: query.q,
        activeOnly: query.active_only !== "false",
      });
    },
    {
      query: t.Object({
        q: t.Optional(t.Nullable(t.String())),
        active_only: t.Optional(t.Nullable(t.String())),
      }),
      detail: { summary: "List departments with wallet summary" },
    },
  );
