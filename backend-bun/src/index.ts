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
import { getMyWallet, listFamilyWallets, getWallet, listTransactions, adjustBalance, transferWithinFamily, cashierTopup, adjustDepartmentBalance, listDepartmentTransactions } from "@/services/wallet_service";
import { listReceipts, getReceipt, voidReceipt } from "@/services/pos_service";
import { checkout, type CheckoutInput } from "@/services/pos_checkout_service";
import { listBundles, getBundle, checkBundleStock } from "@/services/bundle_service";
import { listReturns, getReturnsByReceipt, getReturn, getReturnHistory } from "@/services/returns_service";
import { listRefundCandidates, createGraduationRefund } from "@/services/refund_service";
import { myChildren, myCoparents, getLowBalanceAlert, studentFamilyContext, childrenByUserId, updateLowBalanceAlert, listLinks, createLink, deleteLink, freezeAllChildren, listOrphans } from "@/services/family_service";
import { login, refresh, logout, me, mockSso, googleSso } from "@/services/auth_service";

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
  )
  // ── Phase 3: Wallet ops ───────────────────────────────────────────────
  .get(
    "/wallets/me",
    async ({ user, set }) => {
      try { return await getMyWallet(user); }
      catch (e) { return handle(set)(e); }
    },
  )
  .get(
    "/wallets/family",
    async ({ user, set }) => {
      if (!hasRole(user.roles, "parent", "staff", "cashier", "manager", "kitchen", "admin", "student")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      try { return await listFamilyWallets(user); }
      catch (e) { return handle(set)(e); }
    },
  )
  .get(
    "/wallets/:id",
    async ({ params, user, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid wallet id" }; }
      try {
        return await getWallet(
          user as typeof user & { shop_id?: string | null; family_code?: string | null },
          id,
        );
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get(
    "/wallets/:id/transactions",
    async ({ params, query, user, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid wallet id" }; }
      try {
        return await listTransactions(
          user as typeof user & { shop_id?: string | null; family_code?: string | null },
          id,
          query.date_from,
          query.date_to,
        );
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({ date_from: t.Optional(t.String()), date_to: t.Optional(t.String()) }),
    },
  )
  .post(
    "/wallets/:id/adjust",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid wallet id" }; }
      try {
        return await adjustBalance({
          walletId: id,
          amount: body.amount,
          adminUserId: Number(user.sub),
          reason: body.reason,
          referenceTicket: body.reference_ticket,
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        amount: t.Number(),
        reason: t.String({ minLength: 1, maxLength: 500 }),
        reference_ticket: t.Optional(t.String({ maxLength: 50 })),
      }),
    },
  )
  .post(
    "/wallets/transfer",
    async ({ body, user, set }) => {
      try {
        return await transferWithinFamily({
          fromWalletId: body.from_wallet_id,
          toWalletId: body.to_wallet_id,
          amount: body.amount,
          initiatorUserId: Number(user.sub),
          initiatorIsAdmin: hasRole(user.roles, "admin") || user.is_superuser,
          initiatorRoles: user.roles,
          note: body.note,
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        from_wallet_id: t.Number(),
        to_wallet_id: t.Number(),
        amount: t.Number({ exclusiveMinimum: 0 }),
        note: t.Optional(t.String({ maxLength: 500 })),
      }),
    },
  )
  // ── Phase 4: POS receipts (read-only + void) ──────────────────────────
  .get(
    "/pos/receipt",
    async ({ query, user, set }) => {
      try {
        return await listReceipts({
          caller: user as typeof user & { shop_id?: string | null },
          q: query.q,
          shopId: query.shop_id,
          shopIds: query.shop_ids,
          transactionMode: query.transaction_mode,
          requesterUserId: query.requester_user_id ? Number(query.requester_user_id) : undefined,
          page: query.page ? Number(query.page) : undefined,
          pageSize: query.page_size ? Number(query.page_size) : undefined,
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        shop_id: t.Optional(t.String()),
        shop_ids: t.Optional(t.String()),
        transaction_mode: t.Optional(t.String()),
        requester_user_id: t.Optional(t.String()),
        page: t.Optional(t.String()),
        page_size: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/pos/receipt/:id",
    async ({ params, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid receipt id" }; }
      try { return await getReceipt(id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/pos/checkout",
    async ({ body, user, set }) => {
      if (!hasRole(user.roles, "cashier", "manager", "admin", "kiosk")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      try {
        return await checkout({ ...(body as Omit<CheckoutInput, "userId">), userId: Number(user.sub) });
      } catch (e) {
        const err = e as { status?: number; message?: string; code?: string };
        if (err.status && err.status >= 400 && err.status < 500) {
          set.status = err.status;
          return err.code
            ? { detail: err.message ?? "Bad request", code: err.code }
            : { detail: err.message ?? "Bad request" };
        }
        throw e;
      }
    },
    {
      body: t.Object({
        transaction_mode: t.Optional(t.String()),
        payment_method: t.String(),
        payer_kind: t.Optional(t.String()),
        customer_id: t.Optional(t.Nullable(t.Number())),
        payer_user_id: t.Optional(t.Nullable(t.Number())),
        payer_department_id: t.Optional(t.Nullable(t.Number())),
        requester_user_id: t.Optional(t.Nullable(t.Number())),
        items: t.Array(t.Object({
          product_variant_id: t.Number(),
          quantity: t.Number(),
          unit_price: t.Number({ minimum: 0 }),
          price_override: t.Optional(t.Nullable(t.Number())),
          discount: t.Optional(t.Number()),
          options: t.Optional(t.Array(t.Object({
            option_id: t.Number(),
            quantity: t.Optional(t.Number()),
          }))),
          is_bundle: t.Optional(t.Boolean()),
          bundle_id: t.Optional(t.Nullable(t.Number())),
        })),
        edc_terminal_ref: t.Optional(t.Nullable(t.String())),
        edc_approval_code: t.Optional(t.Nullable(t.String())),
        edc_masked_card: t.Optional(t.Nullable(t.String())),
        cash_received: t.Optional(t.Nullable(t.Number())),
        discount: t.Optional(t.Number()),
        notes: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .post(
    "/pos/void/:id",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid receipt id" }; }
      try {
        return await voidReceipt({
          caller: user as typeof user & { shop_id?: string | null },
          receiptId: id,
          reason: body?.reason ?? null,
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Optional(t.Object({ reason: t.Optional(t.String()) })),
    },
  )
  // ── Phase 5: Bundles + Returns + Graduation Refund ─────────────────────
  .get(
    "/shops/:shopId/bundles",
    async ({ params, query, set }) => {
      try { return await listBundles(params.shopId, query.include_inactive === "true"); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ shopId: t.String() }),
      query: t.Object({ include_inactive: t.Optional(t.String()) }),
    },
  )
  .get(
    "/shops/:shopId/bundles/:bundleId",
    async ({ params, set }) => {
      const id = Number(params.bundleId);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid bundle id" }; }
      try { return await getBundle(params.shopId, id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ shopId: t.String(), bundleId: t.String() }) },
  )
  .get(
    "/shops/:shopId/bundles/:bundleId/stock",
    async ({ params, set }) => {
      const id = Number(params.bundleId);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid bundle id" }; }
      try { return await checkBundleStock(params.shopId, id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ shopId: t.String(), bundleId: t.String() }) },
  )
  .get(
    "/returns",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        return await listReturns({
          q: query.filter,
          shopId: hasRole(user.roles, "admin") || user.is_superuser
            ? null
            : (user as typeof user & { shop_id?: string | null }).shop_id ?? null,
        });
      } catch (e) { return handle(set)(e); }
    },
    { query: t.Object({ filter: t.Optional(t.String()) }) },
  )
  .get(
    "/returns/by-receipt",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        return await getReturnsByReceipt(
          query.receiptId,
          hasRole(user.roles, "admin") || user.is_superuser
            ? null
            : (user as typeof user & { shop_id?: string | null }).shop_id ?? null,
        );
      } catch (e) { return handle(set)(e); }
    },
    { query: t.Object({ receiptId: t.String() }) },
  )
  .get(
    "/returns/:id",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid return id" }; }
      try { return await getReturn(id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get(
    "/return-history",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        return await getReturnHistory({
          q: query.filter,
          shopId: hasRole(user.roles, "admin") || user.is_superuser
            ? null
            : (user as typeof user & { shop_id?: string | null }).shop_id ?? null,
        });
      } catch (e) { return handle(set)(e); }
    },
    { query: t.Object({ filter: t.Optional(t.String()) }) },
  )
  .get(
    "/refund/candidates",
    async ({ user, set }) => {
      if (!hasRole(user.roles, "admin", "refund_officer")) { set.status = 403; return { detail: "Forbidden" }; }
      try { return await listRefundCandidates(); }
      catch (e) { return handle(set)(e); }
    },
  )
  .post(
    "/refund/:customer_id",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "refund_officer")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.customer_id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid customer id" }; }
      try {
        return await createGraduationRefund({
          customerId: id,
          amount: body.amount,
          method: body.method,
          notes: body.notes ?? null,
          userId: Number(user.sub),
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ customer_id: t.String() }),
      body: t.Object({
        amount: t.Number({ exclusiveMinimum: 0 }),
        method: t.Union([t.Literal("CASH"), t.Literal("BANK_TRANSFER"), t.Literal("CHEQUE")]),
        notes: t.Optional(t.String({ maxLength: 500 })),
      }),
    },
  )
  // ── Phase 3.x: Cashier topup + Dept adjust ─────────────────────────────
  .post(
    "/wallets/:id/cashier-topup",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "cashier", "manager", "admin", "staff", "kiosk")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid wallet id" }; }
      try {
        return await cashierTopup({
          walletId: id,
          amount: body.amount,
          cashierUserId: Number(user.sub),
          notes: body.notes,
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        amount: t.Number({ exclusiveMinimum: 0 }),
        notes: t.Optional(t.String({ maxLength: 500 })),
      }),
    },
  )
  .post(
    "/admin/departments/:department_id/adjust",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const id = Number(params.department_id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid department id" }; }
      try {
        return await adjustDepartmentBalance({
          departmentId: id,
          amount: body.amount,
          adminUserId: Number(user.sub),
          reason: body.reason,
          referenceTicket: body.reference_ticket,
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ department_id: t.String() }),
      body: t.Object({
        amount: t.Number(),
        reason: t.String({ minLength: 1, maxLength: 500 }),
        reference_ticket: t.Optional(t.String({ maxLength: 50 })),
      }),
    },
  )
  .get(
    "/admin/departments/:department_id/transactions",
    async ({ params, query, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const id = Number(params.department_id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid department id" }; }
      try {
        return await listDepartmentTransactions({
          departmentId: id,
          limit: query.limit ? Number(query.limit) : undefined,
          dateFrom: query.date_from,
          dateTo: query.date_to,
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ department_id: t.String() }),
      query: t.Object({
        limit: t.Optional(t.String()),
        date_from: t.Optional(t.String()),
        date_to: t.Optional(t.String()),
      }),
    },
  )
  // ── Phase 6: Family / Parent portal (read-only) ────────────────────────
  .get(
    "/family/me",
    async ({ user, set }) => {
      if (!hasRole(user.roles, "parent", "staff", "cashier", "manager", "kitchen", "admin")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      try { return await myChildren(Number(user.sub)); }
      catch (e) { return handle(set)(e); }
    },
  )
  .get(
    "/family/me/coparents",
    async ({ user, set }) => {
      if (!hasRole(user.roles, "parent", "staff", "cashier", "manager", "kitchen", "admin")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      const familyCode = (user as typeof user & { family_code?: string | null }).family_code ?? null;
      try { return await myCoparents(Number(user.sub), familyCode); }
      catch (e) { return handle(set)(e); }
    },
  )
  .get(
    "/family/me/children/:child_id/low-balance-alert",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "parent", "staff", "cashier", "manager", "kitchen", "admin")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      const id = Number(params.child_id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid child id" }; }
      try { return await getLowBalanceAlert(Number(user.sub), id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ child_id: t.String() }) },
  )
  .get(
    "/family/context/:student_code",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      try { return await studentFamilyContext(params.student_code); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ student_code: t.String() }) },
  )
  .get(
    "/family/by-user/:user_id",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const id = Number(params.user_id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid user id" }; }
      try { return await childrenByUserId(id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ user_id: t.String() }) },
  )
  // ── Phase 6.x: Family writes ───────────────────────────────────────────
  .put(
    "/family/me/children/:child_id/low-balance-alert",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "parent", "staff", "cashier", "manager", "kitchen", "admin")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      const id = Number(params.child_id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid child id" }; }
      try {
        return await updateLowBalanceAlert({
          parentUserId: Number(user.sub),
          childId: id,
          enabled: body.enabled,
          threshold: body.threshold ?? null,
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ child_id: t.String() }),
      body: t.Object({
        enabled: t.Boolean(),
        threshold: t.Optional(t.Number()),
      }),
    },
  )
  .get(
    "/family/links",
    async ({ user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      try { return await listLinks(); }
      catch (e) { return handle(set)(e); }
    },
  )
  .post(
    "/family/links",
    async ({ body, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      try {
        set.status = 201;
        return await createLink({
          parentUserId: body.parent_user_id,
          childCustomerId: body.child_customer_id,
          relation: body.relation,
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        parent_user_id: t.Number(),
        child_customer_id: t.Number(),
        relation: t.Optional(t.String()),
      }),
    },
  )
  .delete(
    "/family/links/:link_id",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const id = Number(params.link_id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid link id" }; }
      try { return await deleteLink(id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ link_id: t.String() }) },
  )
  .post(
    "/family/freeze-all",
    async ({ body, user, set }) => {
      if (!hasRole(user.roles, "admin", "parent", "staff", "cashier", "manager", "kitchen")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      try {
        return await freezeAllChildren({
          caller: { id: Number(user.sub), isAdmin: hasRole(user.roles, "admin") || user.is_superuser },
          parentUserId: body.parent_user_id,
          frozen: body.frozen,
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        parent_user_id: t.Number(),
        frozen: t.Boolean(),
      }),
    },
  )
  .get(
    "/family/orphans",
    async ({ user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      try { return await listOrphans(); }
      catch (e) { return handle(set)(e); }
    },
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
  // ── Phase 7: Auth (public — no Bearer needed) ──────────────────────────
  .post(
    "/api/v1/auth/login",
    async ({ body, set }) => {
      try { return await login(body.username, body.password); }
      catch (e) { return handle(set)(e); }
    },
    { body: t.Object({ username: t.String(), password: t.String() }) },
  )
  .post(
    "/api/v1/auth/refresh",
    async ({ body, set }) => {
      try { return await refresh(body.refresh_token); }
      catch (e) { return handle(set)(e); }
    },
    { body: t.Object({ refresh_token: t.String() }) },
  )
  .post(
    "/api/v1/auth/sso/mock",
    async ({ body, set }) => {
      try { return await mockSso(body.email); }
      catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        email: t.String(),
        full_name: t.Optional(t.String()),
        provider: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/api/v1/auth/sso/google",
    async ({ body, set }) => {
      try { return await googleSso(body.access_token); }
      catch (e) { return handle(set)(e); }
    },
    { body: t.Object({ access_token: t.String() }) },
  )
  // Public settings — no auth, mounted at root so the group's requireAuth
  // derive can't reject it.
  .get("/api/v1/admin/settings/public", async () => await getPublicSettings())
  .group("/api/v1", (api) =>
    api
      .use(requireAuth)
      .get("/me", ({ user }) => ({
        sub: user.sub,
        username: user.username,
        roles: user.roles,
        is_superuser: user.is_superuser,
      }))
      .get(
        "/auth/me",
        async ({ user, set }) => {
          try { return await me(Number(user.sub)); }
          catch (e) { return handle(set)(e); }
        },
      )
      .post(
        "/auth/logout",
        async ({ user, set }) => {
          await logout(Number(user.sub));
          set.status = 204;
          return null;
        },
      )
      .use(phase2Routes)
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
