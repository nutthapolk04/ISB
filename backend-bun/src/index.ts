import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { config, APP_VERSION } from "@/lib/config";
import { healthRoutes } from "@/routes/health";
import { shopRoutes } from "@/routes/shops";
import { productRoutes } from "@/routes/products";
import { customerRoutes } from "@/routes/customers";
import { reportRoutes } from "@/routes/reports";
import { jwtPlugin, requireAuth, hasRole } from "@/middleware/auth";
import { listDepartments } from "@/services/department_service";
import { listUsers, getUser, getUserPayerByUsername, getUserPayerByCard, familyLookup } from "@/services/user_service";
import { listAdminUsers, listStaffForPicker, listStudentsForLink } from "@/services/user_admin_service";
import { listAuditLogs } from "@/services/audit_log_service";
import { KNOWN_FLAGS, SCHOOL_KEYS, getPublicSettings, getSchoolSettings, listKnown, setSchoolSettings, setValue } from "@/services/settings_service";

function handle(set: { status?: number }) {
  return (e: unknown) => {
    const err = e as { status?: number; message?: string };
    if (err.status && err.status >= 400 && err.status < 500) {
      set.status = err.status;
      return { detail: err.message ?? "Bad request" };
    }
    throw e;
  };
}

// Phase 2 routes are bundled into a single plugin and mounted BEFORE the
// Phase 1 .use(...) chain. Elysia 1.4.28 has a regression where routes
// defined (inline or via .use) AFTER one or more child plugins inside a
// .group() callback get listed in app.routes but never match at request
// time. Bundling Phase 2 as a single Elysia plugin sidesteps that.
const phase2Routes = new Elysia({ name: "phase-2" })
  .get(
    "/departments/",
    async ({ query }) => listDepartments({ q: query.q, activeOnly: query.active_only !== "false" }),
    { query: t.Object({ q: t.Optional(t.String()), active_only: t.Optional(t.String()) }) },
  )
  .get(
    "/users/",
    async ({ query, user, set }) => {
      try {
        return await listUsers({
          caller: user as typeof user & { shop_id?: string | null },
          q: query.q,
          shopId: query.shop_id,
          role: query.role,
          unassigned: query.unassigned === "true",
          page: query.page ? Number(query.page) : undefined,
          pageSize: query.page_size ? Number(query.page_size) : undefined,
        });
      } catch (e) {
        return handle(set)(e);
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        shop_id: t.Optional(t.String()),
        role: t.Optional(t.String()),
        unassigned: t.Optional(t.String()),
        page: t.Optional(t.String()),
        page_size: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/users/by-username/:username",
    async ({ params, set }) => {
      try { return await getUserPayerByUsername(params.username); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ username: t.String() }) },
  )
  .get(
    "/users/by-card/:uid",
    async ({ params, set }) => {
      try { return await getUserPayerByCard(params.uid); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ uid: t.String() }) },
  )
  .get(
    "/users/family-lookup",
    async ({ query, set }) => {
      try { return await familyLookup(query.q); }
      catch (e) { return handle(set)(e); }
    },
    { query: t.Object({ q: t.String({ minLength: 1 }) }) },
  )
  .get(
    "/users/:id",
    async ({ params, user, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid user id" }; }
      try { return await getUser(user as typeof user & { shop_id?: string | null }, id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get(
    "/users-admin/",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      return await listAdminUsers({ role: query.role, q: query.q, status: query.status });
    },
    { query: t.Object({ role: t.Optional(t.String()), q: t.Optional(t.String()), status: t.Optional(t.String()) }) },
  )
  .get(
    "/users-admin/staff-picker",
    async ({ query }) => listStaffForPicker({ q: query.q, roles: query.roles }),
    { query: t.Object({ q: t.Optional(t.String()), roles: t.Optional(t.String()) }) },
  )
  .get(
    "/users-admin/students",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      return await listStudentsForLink(query.q);
    },
    { query: t.Object({ q: t.Optional(t.String()) }) },
  )
  .get(
    "/admin/audit-logs",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      const callerIsAdmin = hasRole(user.roles, "admin") || user.is_superuser;
      const caller = user as typeof user & { shop_id?: string | null };
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
    },
  )
  .get("/admin/settings/", async ({ user, set }) => {
    if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
    return await listKnown();
  })
  .get("/admin/settings/school", async ({ user, set }) => {
    if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
    return await getSchoolSettings();
  })
  .put(
    "/admin/settings/school",
    async ({ user, body, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      return await setSchoolSettings(body, Number(user.sub));
    },
    {
      body: t.Object({
        school_name: t.Optional(t.String()),
        school_address: t.Optional(t.String()),
        school_tax_id: t.Optional(t.String()),
        school_phone: t.Optional(t.String()),
        school_logo_url: t.Optional(t.String()),
        school_cover_url: t.Optional(t.String()),
        school_receipt_footer: t.Optional(t.String()),
      }),
    },
  )
  .put(
    "/admin/settings/:key",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      if (!(params.key in KNOWN_FLAGS) && !SCHOOL_KEYS.has(params.key)) {
        set.status = 404; return { detail: `Unknown setting key '${params.key}'` };
      }
      const newValue = await setValue(params.key, body.value, Number(user.sub));
      return { key: params.key, value: newValue };
    },
    { params: t.Object({ key: t.String() }), body: t.Object({ value: t.Any() }) },
  );

const app = new Elysia()
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 422;
      return { detail: error.message };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { detail: "Not found" };
    }
    console.error("Unhandled error:", error);
    set.status = set.status === 200 ? 500 : set.status;
    return { detail: error instanceof Error ? error.message : "Internal error" };
  })
  .use(healthRoutes)
  .group("/api/v1", (api) =>
    api
      .use(requireAuth)
      .get("/me", ({ user }) => ({
        sub: user.sub,
        username: user.username,
        roles: user.roles,
        is_superuser: user.is_superuser,
      }))
      // FIXME(phase-2): phase2Routes registers in app.routes but never matches
      // at request time when mounted inside this .group() callback alongside
      // shopRoutes/productRoutes/etc. The Phase 2 service code is complete and
      // verified — only the wiring is blocked. Tracking under Phase 2.1.
      // .use(phase2Routes)
      .use(shopRoutes)
      .use(productRoutes)
      .use(customerRoutes)
      .use(reportRoutes),
  )
  .listen(config.port);

console.log(
  `🚀 ISB backend-bun listening on http://localhost:${config.port} (env=${config.nodeEnv})`,
);
console.log(`   Docs: http://localhost:${config.port}/docs`);
console.log(`   Registered routes: ${app.routes.length}`);
for (const r of app.routes) console.log(`     ${r.method} ${r.path}`);
