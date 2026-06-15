import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { config, APP_VERSION } from "@/lib/config";
import { ensureSchema } from "@/db/ensure_schema";
import { healthRoutes } from "@/routes/health";

// Run idempotent ALTER TABLE patches before we start binding routes.
// The Bun container's Dockerfile doesn't execute the FastAPI start.sh, so
// new Drizzle schema columns need this hook to actually exist in the DB.
// We don't await at module top level because Bun handles top-level await,
// but we kick it off as a fire-and-forget that errors loudly. If a patch
// fails, the offending endpoint will throw — better than silently passing.
await ensureSchema();
import { shopRoutes } from "@/routes/shops";
import { productRoutes } from "@/routes/products";
import { customerRoutes } from "@/routes/customers";
import { freezeCard, setDailyLimit, updateAllergies, setNegativeCreditLimit, bindCard, createStudent, updateCustomerBasic, deleteCustomer } from "@/services/customer_service";
import { createUser, updateUser, deleteUser } from "@/services/user_service";
import { reportRoutes } from "@/routes/reports";
import { jwtPlugin, requireAuth, hasRole } from "@/middleware/auth";
import { listDepartments } from "@/services/department_service";
import { listUsers, getUser, getUserPayerByUsername, getUserPayerByCard, familyLookup } from "@/services/user_service";
import {
  listAdminUsers,
  listStaffForPicker,
  listStudentsForLink,
  getAdminUser,
  updateAdminUser,
  createStudent as createStudentUserAccount,
  getUserFamily,
  updateFamilyProfile,
  linkStudentToUser,
  unlinkStudent,
} from "@/services/user_admin_service";
import { listAuditLogs } from "@/services/audit_log_service";
import { KNOWN_FLAGS, SCHOOL_KEYS, getPublicSettings, getSchoolSettings, listKnown, setSchoolSettings, setValue } from "@/services/settings_service";
import { getMyWallet, listFamilyWallets, getWallet, listTransactions, adjustBalance, transferWithinFamily, cashierTopup, adjustDepartmentBalance, listDepartmentTransactions } from "@/services/wallet_service";
import { listReceipts, getReceipt, voidReceipt } from "@/services/pos_service";
import { checkout, type CheckoutInput } from "@/services/pos_checkout_service";
import { createPosQrIntent, getPosQrIntent, cancelPosQrIntent, confirmPosQrSale } from "@/services/pos_qr_service";
import { qrInquiry as bayQrInquiry } from "@/services/pymt_gateway";
import { listBundles, getBundle, checkBundleStock, createBundle, updateBundle, deleteBundle, reorderBundles } from "@/services/bundle_service";
import {
  createShopProduct, updateShopProduct, deleteShopProduct,
  receiveStock, adjustStock,
  createShopCategory, updateShopCategory, deleteShopCategory,
} from "@/services/shop_product_service";
import { listSpendingGroups, getSpendingGroup, createSpendingGroup, updateSpendingGroup, deleteSpendingGroup, listAssignableShops, setLinkedShops } from "@/services/spending_group_service";
import { listUoms, getUom, createUom, updateUom, deleteUom, seedDefaultUoms } from "@/services/uom_service";
import { listPanels, createPanel, updatePanel, deletePanel, getPanelItems, setItemPrice, setBundleItemPrice } from "@/services/price_panel_service";
import { listReturns, getReturnsByReceipt, getReturn, getReturnHistory, createReturn, createReturnWithoutReceipt, updateReturn, deleteReturn, processRefund, processExchange, searchReceipts, getExchangeProducts } from "@/services/returns_service";
import { listRefundCandidates, createGraduationRefund } from "@/services/refund_service";
import { searchRefundFamilies, getRefundFamilyRoster } from "@/services/refund_family_service";
import { buildTemplate, importProducts, importStockReceive, importStore } from "@/services/admin_import_service";
import { myChildren, myCoparents, getLowBalanceAlert, studentFamilyContext, childrenByUserId, updateLowBalanceAlert, listLinks, createLink, deleteLink, freezeAllChildren, listOrphans } from "@/services/family_service";
import {
  login,
  refresh,
  logout,
  me,
  mockSso,
  googleSso,
  listUserRoles,
  assignRoleToUser,
  removeRoleFromUser,
} from "@/services/auth_service";
import { listImages, getImageBinary, reorderImages, deleteImage, uploadImage } from "@/services/customer_display_service";
import { listSyncLogs, syncStats } from "@/services/sync_log_service";
import { closeDay } from "@/services/canteen_service";
import { scopeShop } from "@/services/report_service";
import { listCardholders, getSyncLog, listSyncStatuses, listSyncAudit, createCardholder } from "@/services/cardholder_service";
import { createTopupIntent, getTopupStatus, confirmTopup, userCanAccessWallet, handleBayCallback, inquireTopupFromGateway } from "@/services/topup_service";
import { adjustmentReport, transferReport } from "@/services/admin_reports_service";
import { runSync } from "@/services/powerschool_sync";

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
    { query: t.Object({ q: t.Optional(t.Nullable(t.String())), active_only: t.Optional(t.Nullable(t.String())) }) },
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
        q: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        role: t.Optional(t.Nullable(t.String())),
        unassigned: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
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
    { query: t.Object({ role: t.Optional(t.Nullable(t.String())), q: t.Optional(t.Nullable(t.String())), status: t.Optional(t.Nullable(t.String())) }) },
  )
  .get(
    "/users-admin/staff-picker",
    async ({ query }) => listStaffForPicker({ q: query.q, roles: query.roles }),
    { query: t.Object({ q: t.Optional(t.Nullable(t.String())), roles: t.Optional(t.Nullable(t.String())) }) },
  )
  .get(
    "/users-admin/students",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      return await listStudentsForLink(query.q);
    },
    { query: t.Object({ q: t.Optional(t.Nullable(t.String())) }) },
  )
  .post(
    "/users-admin/students",
    async ({ body, user, set }) => {
      try {
        set.status = 201;
        return await createStudentUserAccount(user.roles, body);
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        customer_code: t.String(),
        username: t.Optional(t.Nullable(t.String())),
        password: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .get(
    "/users-admin/:user_id",
    async ({ params, user, set }) => {
      const id = Number(params.user_id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid user id" }; }
      try { return await getAdminUser(user.roles, id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ user_id: t.String() }) },
  )
  .patch(
    "/users-admin/:user_id",
    async ({ params, body, user, set }) => {
      const id = Number(params.user_id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid user id" }; }
      try { return await updateAdminUser(user.roles, Number(user.sub), id, body); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ user_id: t.String() }),
      body: t.Object({
        full_name: t.Optional(t.Nullable(t.String())),
        email: t.Optional(t.Nullable(t.String())),
        role: t.Optional(t.Nullable(t.String())),
        external_id: t.Optional(t.Nullable(t.String())),
        external_id_change_reason: t.Optional(t.Nullable(t.String())),
        family_code: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
        photo_url: t.Optional(t.Nullable(t.String())),
        status: t.Optional(t.Nullable(t.String())),
        allergies: t.Optional(t.Nullable(t.String())),
        card_uid: t.Optional(t.Nullable(t.String())),
        customer_type: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .get(
    "/users-admin/:user_id/family",
    async ({ params, user, set }) => {
      const id = Number(params.user_id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid user id" }; }
      try { return await getUserFamily(user.roles, id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ user_id: t.String() }) },
  )
  .patch(
    "/users-admin/family-profile/:family_code",
    async ({ params, body, user, set }) => {
      try { return await updateFamilyProfile(user.roles, params.family_code, body); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ family_code: t.String() }),
      body: t.Object({
        notification_emails: t.Optional(t.Nullable(t.Array(t.String()))),
        login_ids: t.Optional(t.Nullable(t.Array(t.String()))),
      }),
    },
  )
  .post(
    "/users-admin/:user_id/link-student",
    async ({ params, body, user, set }) => {
      const id = Number(params.user_id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid user id" }; }
      try {
        set.status = 201;
        return await linkStudentToUser(user.roles, id, body);
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ user_id: t.String() }),
      body: t.Object({
        child_customer_id: t.Number(),
        relation: t.Optional(t.Nullable(t.String())),
        parent_rank: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .delete(
    "/users-admin/:user_id/link-student/:customer_id",
    async ({ params, user, set }) => {
      const userIdN = Number(params.user_id);
      const customerIdN = Number(params.customer_id);
      if (!Number.isInteger(userIdN) || !Number.isInteger(customerIdN)) {
        set.status = 422;
        return { detail: "Invalid id" };
      }
      try { return await unlinkStudent(user.roles, userIdN, customerIdN); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({
        user_id: t.String(),
        customer_id: t.String(),
      }),
    },
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
        entity_type: t.Optional(t.Nullable(t.String())),
        action: t.Optional(t.Nullable(t.String())),
        user_id: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .get("/admin/settings/", async ({ user, set }) => {
    if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
    return await listKnown();
  })
  // /admin/settings/school GET is mounted publicly at root level (see below)
  // because the FE's SchoolInfoProvider fires it on every page including
  // /login. PUT stays here under requireAuth + admin.
  .put(
    "/admin/settings/school",
    async ({ user, body, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      return await setSchoolSettings(body, Number(user.sub));
    },
    {
      body: t.Object({
        school_name: t.Optional(t.Nullable(t.String())),
        school_address: t.Optional(t.Nullable(t.String())),
        school_tax_id: t.Optional(t.Nullable(t.String())),
        school_phone: t.Optional(t.Nullable(t.String())),
        school_logo_url: t.Optional(t.Nullable(t.String())),
        school_cover_url: t.Optional(t.Nullable(t.String())),
        school_receipt_footer: t.Optional(t.Nullable(t.String())),
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
      query: t.Object({ date_from: t.Optional(t.Nullable(t.String())), date_to: t.Optional(t.Nullable(t.String())) }),
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
        reference_ticket: t.Optional(t.Nullable(t.String({ maxLength: 50 }))),
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
        note: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
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
        q: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        shop_ids: t.Optional(t.Nullable(t.String())),
        transaction_mode: t.Optional(t.Nullable(t.String())),
        requester_user_id: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
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
  // ── User CRUD writes ───────────────────────────────────────────────────
  .post(
    "/users/",
    async ({ body, user, set }) => {
      try {
        set.status = 201;
        return await createUser(
          user as typeof user & { shop_id?: string | null },
          body as Parameters<typeof createUser>[1],
        );
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        username: t.String({ minLength: 1, maxLength: 50 }),
        password: t.String({ minLength: 6, maxLength: 128 }),
        full_name: t.String({ minLength: 1, maxLength: 255 }),
        role: t.String(),
        shop_id: t.Optional(t.Nullable(t.String())),
        email: t.Optional(t.Nullable(t.String())),
        family_code: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
      }),
    },
  )
  .patch(
    "/users/:id",
    async ({ params, body, user, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid user id" }; }
      try { return await updateUser(user as typeof user & { shop_id?: string | null }, id, body); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        shop_id: t.Optional(t.Nullable(t.String())),
        role: t.Optional(t.Nullable(t.String())),
        full_name: t.Optional(t.Nullable(t.String())),
        is_active: t.Optional(t.Nullable(t.Boolean())),
        email: t.Optional(t.Nullable(t.String())),
        family_code: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
      }),
    },
  )
  .delete(
    "/users/:id",
    async ({ params, user, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid user id" }; }
      try {
        await deleteUser(user, id);
        set.status = 204;
        return null;
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ id: t.String() }) },
  )
  // ── Customer writes ────────────────────────────────────────────────────
  .post(
    "/customers/",
    async ({ body, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      try {
        set.status = 201;
        return await createStudent(body as Parameters<typeof createStudent>[0]);
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        customer_code: t.String(),
        name: t.String(),
        student_code: t.Optional(t.Nullable(t.String())),
        grade: t.Optional(t.Nullable(t.String())),
        email: t.Optional(t.Nullable(t.String())),
        phone: t.Optional(t.Nullable(t.String())),
        allergies: t.Optional(t.Nullable(t.String())),
        dietary_notes: t.Optional(t.Nullable(t.String())),
        card_uid: t.Optional(t.Nullable(t.String())),
        photo_url: t.Optional(t.Nullable(t.String())),
        customer_type_id: t.Optional(t.Nullable(t.Number())),
        initial_balance: t.Optional(t.Nullable(t.Number())),
      }),
    },
  )
  .patch(
    "/customers/:id",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid customer id" }; }
      try { return await updateCustomerBasic(user, id, body); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.Nullable(t.String())),
        grade: t.Optional(t.Nullable(t.String())),
        school_type: t.Optional(t.Nullable(t.String())),
        email: t.Optional(t.Nullable(t.String())),
        phone: t.Optional(t.Nullable(t.String())),
        family_code: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .delete(
    "/customers/:id",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid customer id" }; }
      try {
        await deleteCustomer(id);
        set.status = 204;
        return null;
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/customers/:id/freeze",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "parent", "staff", "cashier", "manager", "kitchen", "admin")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid customer id" }; }
      try { return await freezeCard(user, id, body.frozen); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ frozen: t.Boolean() }),
    },
  )
  .patch(
    "/customers/:id/limit",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "parent", "staff", "cashier", "manager", "kitchen", "admin")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid customer id" }; }
      try { return await setDailyLimit(user, id, body.daily_limit ?? null); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ daily_limit: t.Optional(t.Nullable(t.Number({ minimum: 0 }))) }),
    },
  )
  .patch(
    "/customers/:id/allergies",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid customer id" }; }
      try { return await updateAllergies(id, body); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        allergies: t.Optional(t.Nullable(t.String())),
        dietary_notes: t.Optional(t.Nullable(t.String())),
        allergy_override_note: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .patch(
    "/customers/:id/negative-limit",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid customer id" }; }
      try { return await setNegativeCreditLimit(id, body.negative_credit_limit ?? null); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ negative_credit_limit: t.Optional(t.Nullable(t.Number({ minimum: 0 }))) }),
    },
  )
  .patch(
    "/customers/:id/card",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid customer id" }; }
      try { return await bindCard(id, body.card_uid ?? null); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ card_uid: t.Optional(t.Nullable(t.String())) }),
    },
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
        transaction_mode: t.Optional(t.Nullable(t.String())),
        payment_method: t.String(),
        payer_kind: t.Optional(t.Nullable(t.String())),
        customer_id: t.Optional(t.Nullable(t.Number())),
        payer_user_id: t.Optional(t.Nullable(t.Number())),
        payer_department_id: t.Optional(t.Nullable(t.Number())),
        requester_user_id: t.Optional(t.Nullable(t.Number())),
        items: t.Array(t.Object({
          product_variant_id: t.Number(),
          quantity: t.Number(),
          unit_price: t.Number({ minimum: 0 }),
          price_override: t.Optional(t.Nullable(t.Number())),
          discount: t.Optional(t.Nullable(t.Number())),
          options: t.Optional(t.Array(t.Object({
            option_id: t.Number(),
            quantity: t.Optional(t.Nullable(t.Number())),
          }))),
          is_bundle: t.Optional(t.Nullable(t.Boolean())),
          bundle_id: t.Optional(t.Nullable(t.Number())),
        })),
        edc_terminal_ref: t.Optional(t.Nullable(t.String())),
        edc_approval_code: t.Optional(t.Nullable(t.String())),
        edc_masked_card: t.Optional(t.Nullable(t.String())),
        cash_received: t.Optional(t.Nullable(t.Number())),
        discount: t.Optional(t.Nullable(t.Number())),
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
      body: t.Optional(t.Object({ reason: t.Optional(t.Nullable(t.String())) })),
    },
  )
  // ── POS-sale BAY QR — cart-snapshot intents ───────────────────────────
  .post(
    "/pos/qr-intent",
    async ({ body, user, set }) => {
      if (!hasRole(user.roles, "cashier", "manager", "admin", "kiosk")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      try {
        return await createPosQrIntent({
          cart: { ...(body.cart as Omit<CheckoutInput, "payment_method">), userId: Number(user.sub) },
          cashierUserId: Number(user.sub),
          amount: body.amount,
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        amount: t.Number({ exclusiveMinimum: 0 }),
        // We accept the full checkout payload as opaque cart_snapshot.
        // Backend will re-validate when the webhook calls checkout().
        cart: t.Object({
          transaction_mode: t.Optional(t.Nullable(t.String())),
          payer_kind: t.Optional(t.Nullable(t.String())),
          customer_id: t.Optional(t.Nullable(t.Number())),
          payer_user_id: t.Optional(t.Nullable(t.Number())),
          payer_department_id: t.Optional(t.Nullable(t.Number())),
          requester_user_id: t.Optional(t.Nullable(t.Number())),
          shop_id: t.Optional(t.Nullable(t.String())),
          discount: t.Optional(t.Nullable(t.Number())),
          notes: t.Optional(t.Nullable(t.String())),
          items: t.Array(t.Object({
            product_variant_id: t.Number(),
            quantity: t.Number(),
            unit_price: t.Number({ minimum: 0 }),
            price_override: t.Optional(t.Nullable(t.Number())),
            discount: t.Optional(t.Nullable(t.Number())),
            options: t.Optional(t.Nullable(t.Array(t.Object({
              option_id: t.Number(),
              quantity: t.Optional(t.Nullable(t.Number())),
            })))),
            is_bundle: t.Optional(t.Nullable(t.Boolean())),
            bundle_id: t.Optional(t.Nullable(t.Number())),
          })),
        }),
      }),
    },
  )
  .get(
    "/pos/qr-intent/:refCode/status",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "cashier", "manager", "admin", "kiosk")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      try { return await getPosQrIntent(params.refCode); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ refCode: t.String() }) },
  )
  .post(
    "/pos/qr-intent/:refCode/inquiry",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "cashier", "manager", "admin", "kiosk")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      try {
        // First check local state — if we already know the answer, skip
        // the round-trip to PYMT.
        const local = await getPosQrIntent(params.refCode);
        if (local.status !== "pending" || !local.txn_no) return local;
        // Ask BAY directly
        const inq = await bayQrInquiry({ transactionNo: local.txn_no });
        if (inq.status === "confirmed") {
          await confirmPosQrSale(params.refCode);
        } else if (inq.status === "cancelled") {
          await cancelPosQrIntent(params.refCode);
        }
        // Re-read post-sync
        return await getPosQrIntent(params.refCode);
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ refCode: t.String() }) },
  )
  .post(
    "/pos/qr-intent/:refCode/cancel",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "cashier", "manager", "admin", "kiosk")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      try {
        await cancelPosQrIntent(params.refCode);
        return await getPosQrIntent(params.refCode);
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ refCode: t.String() }) },
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
      query: t.Object({ include_inactive: t.Optional(t.Nullable(t.String())) }),
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
  // ── Customer Display admin + Sync logs ─────────────────────────────────
  .post(
    "/admin/customer-display/images",
    async ({ body, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      try {
        const f = (body as { file?: File }).file;
        if (!f) { set.status = 422; return { detail: "file is required" }; }
        set.status = 201;
        return await uploadImage({ file: f, userId: Number(user.sub) });
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({ file: t.File() }),
    },
  )
  .post(
    "/admin/cardholders",
    async ({ body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        set.status = 201;
        return await createCardholder(body as Parameters<typeof createCardholder>[0]);
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        kind: t.Union([
          t.Literal("student"), t.Literal("parent"), t.Literal("staff"),
          t.Literal("department"), t.Literal("other"),
        ]),
        name: t.Optional(t.Nullable(t.String())),
        family_code: t.Optional(t.Nullable(t.String())),
        card_uid: t.Optional(t.Nullable(t.String())),
        customer_code: t.Optional(t.Nullable(t.String())),
        student_code: t.Optional(t.Nullable(t.String())),
        grade: t.Optional(t.Nullable(t.String())),
        school_type: t.Optional(t.Nullable(t.String())),
        initial_balance: t.Optional(t.Nullable(t.Number())),
        username: t.Optional(t.Nullable(t.String())),
        email: t.Optional(t.Nullable(t.String())),
        password: t.Optional(t.Nullable(t.String())),
        role: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        department_code: t.Optional(t.Nullable(t.String())),
        department_name: t.Optional(t.Nullable(t.String())),
        initial_credit: t.Optional(t.Nullable(t.Number())),
        phone: t.Optional(t.Nullable(t.String())),
        with_wallet: t.Optional(t.Nullable(t.Boolean())),
      }),
    },
  )
  .get(
    "/admin/cardholders",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      const page = query.page ? Math.max(Number(query.page), 1) : 1;
      const pageSize = query.page_size ? Math.min(Math.max(Number(query.page_size), 1), 500) : 50;
      try {
        return await listCardholders({ kind: query.kind ?? null, q: query.q ?? null, page, pageSize });
      } catch (e) { return handle(set)(e); }
    },
    {
      query: t.Object({
        kind: t.Optional(t.Nullable(t.String())),
        q: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  // ── PowerSchool sync (mock, fixture-based) ────────────────────────────
  .post(
    "/sync/run",
    async ({ body, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      try {
        return await runSync({
          triggeredById: Number(user.sub),
          syncType: (body.sync_type as "full" | "delta") ?? "delta",
          targetRoles: body.target_roles ?? ["student", "parent", "staff"],
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        sync_type: t.Optional(t.Union([t.Literal("full"), t.Literal("delta")])),
        target_roles: t.Optional(t.Array(t.String())),
      }),
    },
  )
  .post(
    "/sync/powerschool",
    async ({ body, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const valid = new Set(["student", "parent", "staff", "admin", "manager", "cashier"]);
      const targetRoles = (body.target_roles ?? []).filter((r) => valid.has(r));
      if (targetRoles.length === 0) {
        set.status = 400;
        return { detail: "At least one valid target role is required" };
      }
      try {
        return await runSync({
          triggeredById: Number(user.sub),
          syncType: (body.sync_type as "full" | "delta") ?? "full",
          targetRoles,
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        sync_type: t.Optional(t.Union([t.Literal("full"), t.Literal("delta")])),
        target_roles: t.Optional(t.Array(t.String())),
      }),
    },
  )
  .get(
    "/admin/sync-logs",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        const limit = query.limit ? Math.min(Math.max(Number(query.limit), 1), 200) : 20;
        return await listSyncStatuses(limit);
      } catch (e) { return handle(set)(e); }
    },
    { query: t.Object({ limit: t.Optional(t.Nullable(t.String())) }) },
  )
  .get(
    "/admin/sync-logs/:syncLogId",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.syncLogId);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid sync_log_id" }; }
      try { return await getSyncLog(id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ syncLogId: t.String() }) },
  )
  .get(
    "/admin/sync-audit/:syncLogId",
    async ({ params, query, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.syncLogId);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid sync_log_id" }; }
      try { return await listSyncAudit(id, query.action ?? null); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ syncLogId: t.String() }),
      query: t.Object({ action: t.Optional(t.Nullable(t.String())) }),
    },
  )
  .post(
    "/canteen/:shopId/close-day",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        const effective = scopeShop(user, params.shopId);
        if (!effective) { set.status = 403; return { detail: "Not authorized for that shop" }; }
        return await closeDay(effective);
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ shopId: t.String() }) },
  )
  .delete(
    "/admin/customer-display/images/:id",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid id" }; }
      try {
        await deleteImage(id);
        set.status = 204;
        return null;
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .patch(
    "/admin/customer-display/images/order",
    async ({ body, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      try { return await reorderImages(body.ordered_ids); }
      catch (e) { return handle(set)(e); }
    },
    { body: t.Object({ ordered_ids: t.Array(t.Number()) }) },
  )
  .get(
    "/sync/logs",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      try {
        return await listSyncLogs(
          query.limit ? Math.min(Math.max(Number(query.limit), 1), 200) : 50,
          query.offset ? Math.max(Number(query.offset), 0) : 0,
        );
      } catch (e) { return handle(set)(e); }
    },
    { query: t.Object({ limit: t.Optional(t.Nullable(t.String())), offset: t.Optional(t.Nullable(t.String())) }) },
  )
  .get(
    "/sync/stats",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      try {
        const days = query.days ? Math.min(Math.max(Number(query.days), 1), 365) : 30;
        return await syncStats(days);
      } catch (e) { return handle(set)(e); }
    },
    { query: t.Object({ days: t.Optional(t.Nullable(t.String())) }) },
  )
  // ── Price Panels (Phase 11.x) ──────────────────────────────────────────
  .get(
    "/shops/:shopId/price-panels",
    async ({ params, set }) => {
      try { return await listPanels(params.shopId); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ shopId: t.String() }) },
  )
  .post(
    "/shops/:shopId/price-panels",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        set.status = 201;
        return await createPanel(params.shopId, body.name, body.color ?? null);
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ shopId: t.String() }),
      body: t.Object({ name: t.String({ minLength: 1 }), color: t.Optional(t.Nullable(t.String())) }),
    },
  )
  .patch(
    "/shops/:shopId/price-panels/:panelId",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.panelId);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid panel id" }; }
      try { return await updatePanel(params.shopId, id, body); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ shopId: t.String(), panelId: t.String() }),
      body: t.Object({
        name: t.Optional(t.Nullable(t.String())),
        color: t.Optional(t.Nullable(t.String())),
        sort_order: t.Optional(t.Nullable(t.Number())),
      }),
    },
  )
  .delete(
    "/shops/:shopId/price-panels/:panelId",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.panelId);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid panel id" }; }
      try {
        await deletePanel(params.shopId, id);
        set.status = 204;
        return null;
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ shopId: t.String(), panelId: t.String() }) },
  )
  .get(
    "/shops/:shopId/price-panels/:panelId/items",
    async ({ params, set }) => {
      const id = Number(params.panelId);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid panel id" }; }
      try { return await getPanelItems(params.shopId, id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ shopId: t.String(), panelId: t.String() }) },
  )
  .patch(
    "/shops/:shopId/price-panels/:panelId/items/:productId",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      const pId = Number(params.panelId);
      const prodId = Number(params.productId);
      if (!Number.isInteger(pId) || !Number.isInteger(prodId)) { set.status = 422; return { detail: "Invalid id" }; }
      try { return await setItemPrice(params.shopId, pId, prodId, body); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ shopId: t.String(), panelId: t.String(), productId: t.String() }),
      body: t.Object({
        price: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        short_name: t.Optional(t.Nullable(t.String())),
        included: t.Optional(t.Nullable(t.Boolean())),
      }),
    },
  )
  .patch(
    "/shops/:shopId/price-panels/:panelId/bundle-items/:bundleId",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      const pId = Number(params.panelId);
      const bId = Number(params.bundleId);
      if (!Number.isInteger(pId) || !Number.isInteger(bId)) { set.status = 422; return { detail: "Invalid id" }; }
      try { return await setBundleItemPrice(params.shopId, pId, bId, body); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ shopId: t.String(), panelId: t.String(), bundleId: t.String() }),
      body: t.Object({
        price: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        short_name: t.Optional(t.Nullable(t.String())),
        included: t.Optional(t.Nullable(t.Boolean())),
      }),
    },
  )
  // ── Spending Groups + UoM (Phase 11) ───────────────────────────────────
  .get(
    "/spending-groups/",
    async ({ set }) => {
      try { return await listSpendingGroups(); }
      catch (e) { return handle(set)(e); }
    },
  )
  .get(
    "/spending-groups/:id",
    async ({ params, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid id" }; }
      try { return await getSpendingGroup(id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/spending-groups/",
    async ({ body, user, set }) => {
      if (!user.is_superuser && !hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      try {
        set.status = 201;
        return await createSpendingGroup(body);
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        code: t.String({ minLength: 2, maxLength: 40 }),
        name_en: t.String({ minLength: 1, maxLength: 100 }),
        name_th: t.String({ minLength: 1, maxLength: 100 }),
        daily_limit: t.Number({ exclusiveMinimum: 0 }),
        is_active: t.Optional(t.Nullable(t.Boolean())),
      }),
    },
  )
  .patch(
    "/spending-groups/:id",
    async ({ params, body, user, set }) => {
      if (!user.is_superuser && !hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid id" }; }
      try { return await updateSpendingGroup(id, body); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name_en: t.Optional(t.Nullable(t.String())),
        name_th: t.Optional(t.Nullable(t.String())),
        daily_limit: t.Optional(t.Nullable(t.Number({ exclusiveMinimum: 0 }))),
        is_active: t.Optional(t.Nullable(t.Boolean())),
      }),
    },
  )
  .delete(
    "/spending-groups/:id",
    async ({ params, user, set }) => {
      if (!user.is_superuser && !hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid id" }; }
      try {
        await deleteSpendingGroup(id);
        set.status = 204;
        return null;
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get(
    "/spending-groups/:id/shops",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid id" }; }
      try { return await listAssignableShops(id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .patch(
    "/spending-groups/:id/shops",
    async ({ params, body, user, set }) => {
      if (!user.is_superuser && !hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid id" }; }
      try { return await setLinkedShops(id, body.shop_ids); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ shop_ids: t.Array(t.String()) }),
    },
  )
  .get(
    "/uom/",
    async ({ query, set }) => {
      try { return await listUoms(query.active_only !== "false"); }
      catch (e) { return handle(set)(e); }
    },
    { query: t.Object({ active_only: t.Optional(t.Nullable(t.String())) }) },
  )
  .get(
    "/uom/:id",
    async ({ params, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid id" }; }
      try { return await getUom(id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/uom/",
    async ({ body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        set.status = 201;
        return await createUom(body);
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        code: t.String({ minLength: 1, maxLength: 20 }),
        name: t.String({ minLength: 1, maxLength: 100 }),
        name_en: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
        base_uom_id: t.Optional(t.Nullable(t.Number())),
        conversion_factor: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
      }),
    },
  )
  .patch(
    "/uom/:id",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid id" }; }
      try { return await updateUom(id, body); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        code: t.Optional(t.Nullable(t.String())),
        name: t.Optional(t.Nullable(t.String())),
        name_en: t.Optional(t.Nullable(t.String())),
        base_uom_id: t.Optional(t.Nullable(t.Number())),
        conversion_factor: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        is_active: t.Optional(t.Nullable(t.Boolean())),
      }),
    },
  )
  .delete(
    "/uom/:id",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid id" }; }
      try { return await deleteUom(id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/uom/seed-defaults",
    async ({ user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      try { return await seedDefaultUoms(); }
      catch (e) { return handle(set)(e); }
    },
  )
  // ── Inventory writes (Phase 8) ─────────────────────────────────────────
  .post(
    "/shops/:shopId/products",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        set.status = 201;
        return await createShopProduct(params.shopId, body as Parameters<typeof createShopProduct>[1], Number(user.sub));
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ shopId: t.String() }),
      body: t.Object({
        product_code: t.String({ minLength: 1, maxLength: 50 }),
        barcode: t.Optional(t.Nullable(t.String())),
        name: t.String({ minLength: 1, maxLength: 255 }),
        category: t.Optional(t.Nullable(t.String())),
        external_price: t.Number({ minimum: 0 }),
        internal_price: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        vat_percent: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 100 }))),
        avg_cost: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        stock: t.Optional(t.Nullable(t.Number())),
        min_stock: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        color: t.Optional(t.Nullable(t.String())),
        uom_id: t.Optional(t.Nullable(t.Number())),
      }),
    },
  )
  .patch(
    "/shops/:shopId/products/:productId",
    async ({ params, body, user, set }) => {
      const id = Number(params.productId);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid product id" }; }
      try { return await updateShopProduct(user, params.shopId, id, body); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ shopId: t.String(), productId: t.String() }),
      body: t.Object({
        product_code: t.Optional(t.Nullable(t.String())),
        barcode: t.Optional(t.Nullable(t.String())),
        name: t.Optional(t.Nullable(t.String())),
        category: t.Optional(t.Nullable(t.String())),
        external_price: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        internal_price: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        vat_percent: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 100 }))),
        min_stock: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        is_active: t.Optional(t.Nullable(t.Boolean())),
        photo_url: t.Optional(t.Nullable(t.String())),
        color: t.Optional(t.Nullable(t.String())),
        uom_id: t.Optional(t.Nullable(t.Number())),
        short_name: t.Optional(t.Nullable(t.String())),
        sort_order: t.Optional(t.Nullable(t.Number())),
      }),
    },
  )
  .delete(
    "/shops/:shopId/products/:productId",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.productId);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid product id" }; }
      try {
        await deleteShopProduct(user, params.shopId, id);
        set.status = 204;
        return null;
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ shopId: t.String(), productId: t.String() }) },
  )
  .post(
    "/shops/:shopId/receive",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        return await receiveStock({
          shopId: params.shopId,
          items: body.items as Parameters<typeof receiveStock>[0]["items"],
          userId: Number(user.sub),
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ shopId: t.String() }),
      body: t.Object({
        items: t.Array(t.Object({
          product_id: t.Number(),
          qty: t.Number({ exclusiveMinimum: 0 }),
          cost_per_unit: t.Number({ minimum: 0 }),
          po: t.Optional(t.Nullable(t.String())),
          invoice: t.Optional(t.Nullable(t.String())),
          note: t.Optional(t.Nullable(t.String())),
        }), { minItems: 1 }),
      }),
    },
  )
  .post(
    "/shops/:shopId/adjust",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        return await adjustStock({
          shopId: params.shopId,
          productId: body.product_id,
          delta: body.delta,
          reason: body.reason,
          costPerUnit: body.cost_per_unit ?? null,
          userId: Number(user.sub),
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ shopId: t.String() }),
      body: t.Object({
        product_id: t.Number(),
        delta: t.Number(),
        reason: t.String({ minLength: 1 }),
        cost_per_unit: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
      }),
    },
  )
  .post(
    "/shops/:shopId/categories",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        set.status = 201;
        return await createShopCategory(params.shopId, body.name);
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ shopId: t.String() }),
      body: t.Object({ name: t.String({ minLength: 1, maxLength: 100 }) }),
    },
  )
  .patch(
    "/shops/:shopId/categories/:categoryId",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      try { return await updateShopCategory(params.shopId, params.categoryId, body.name); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ shopId: t.String(), categoryId: t.String() }),
      body: t.Object({ name: t.String({ minLength: 1, maxLength: 100 }) }),
    },
  )
  .delete(
    "/shops/:shopId/categories/:categoryId",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        await deleteShopCategory(params.shopId, params.categoryId);
        set.status = 204;
        return null;
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ shopId: t.String(), categoryId: t.String() }) },
  )
  .post(
    "/shops/:shopId/bundles",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        set.status = 201;
        return await createBundle(params.shopId, body as Parameters<typeof createBundle>[1]);
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ shopId: t.String() }),
      body: t.Object({
        bundle_code: t.String({ minLength: 1, maxLength: 50 }),
        barcode: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
        name: t.String({ minLength: 1, maxLength: 255 }),
        description: t.Optional(t.Nullable(t.String())),
        external_price: t.Number({ minimum: 0 }),
        internal_price: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        color: t.Optional(t.Nullable(t.String())),
        items: t.Array(t.Object({ product_id: t.Number(), quantity: t.Number({ minimum: 1 }) })),
      }),
    },
  )
  .patch(
    "/shops/:shopId/bundles/:bundleId",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.bundleId);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid bundle id" }; }
      try { return await updateBundle(params.shopId, id, body); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ shopId: t.String(), bundleId: t.String() }),
      body: t.Object({
        bundle_code: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 50 }))),
        barcode: t.Optional(t.Nullable(t.String())),
        name: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 255 }))),
        description: t.Optional(t.Nullable(t.String())),
        external_price: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        internal_price: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        photo_url: t.Optional(t.Nullable(t.String())),
        color: t.Optional(t.Nullable(t.String())),
        is_active: t.Optional(t.Nullable(t.Boolean())),
        items: t.Optional(t.Nullable(t.Array(t.Object({ product_id: t.Number(), quantity: t.Number({ minimum: 1 }) })))),
      }),
    },
  )
  .delete(
    "/shops/:shopId/bundles/:bundleId",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.bundleId);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid bundle id" }; }
      try { return await deleteBundle(params.shopId, id); }
      catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ shopId: t.String(), bundleId: t.String() }) },
  )
  .post(
    "/shops/:shopId/bundles/reorder",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      try { return await reorderBundles(params.shopId, body.sort_map); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ shopId: t.String() }),
      body: t.Object({ sort_map: t.Record(t.String(), t.Number()) }),
    },
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
  .post(
    "/returns/create",
    async ({ body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        return await createReturn({
          receiptId: body.receiptId,
          items: body.items as Parameters<typeof createReturn>[0]["items"],
          reason: body.reason,
          userId: Number(user.sub),
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        receiptId: t.String(),
        items: t.Array(t.Object({
          productCode: t.String(),
          productName: t.String(),
          quantity: t.Number({ minimum: 1 }),
          returnQuantity: t.Number({ minimum: 1 }),
          price: t.Number({ minimum: 0 }),
          bundleId: t.Optional(t.Nullable(t.Number())),
        })),
        reason: t.String({ minLength: 1 }),
      }),
    },
  )
  .post(
    "/returns/create-without-receipt",
    async ({ body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        return await createReturnWithoutReceipt({
          items: body.items as Parameters<typeof createReturnWithoutReceipt>[0]["items"],
          reason: body.reason,
          customerName: body.customerName ?? null,
          notes: body.notes ?? null,
          userId: Number(user.sub),
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        items: t.Array(t.Object({
          productCode: t.String(),
          productName: t.String(),
          returnQuantity: t.Number({ minimum: 1 }),
          unitPrice: t.Number({ minimum: 0 }),
          shopId: t.String(),
        })),
        reason: t.String({ minLength: 1 }),
        customerName: t.Optional(t.Nullable(t.String())),
        notes: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .put(
    "/returns/:id",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid return id" }; }
      try { return await updateReturn(id, body); }
      catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        productName: t.Optional(t.Nullable(t.String())),
        quantity: t.Optional(t.Nullable(t.Number())),
        returnQuantity: t.Optional(t.Nullable(t.Number())),
        reason: t.Optional(t.Nullable(t.String())),
        status: t.Optional(t.Nullable(t.String())),
        priceType: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .delete(
    "/returns/:id",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid return id" }; }
      try {
        await deleteReturn(id);
        return { success: true };
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/returns/:id/refund",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid return id" }; }
      try {
        return await processRefund({
          returnId: id,
          reason: body.reason,
          notes: body.notes ?? null,
          userId: Number(user.sub),
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        returnItems: t.Optional(t.Array(t.Object({ productCode: t.String(), returnQuantity: t.Number() }))),
        exchangeItems: t.Optional(t.Nullable(t.Array(t.Object({ productCode: t.String(), quantity: t.Number() })))),
        refundMethod: t.Optional(t.Nullable(t.String())),
        reason: t.String(),
        notes: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .post(
    "/returns/:id/exchange",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid return id" }; }
      try {
        return await processExchange({
          returnId: id,
          exchangeItems: body.exchangeItems as Parameters<typeof processExchange>[0]["exchangeItems"],
          reason: body.reason,
          notes: body.notes ?? null,
          userId: Number(user.sub),
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        returnItems: t.Optional(t.Array(t.Object({ productCode: t.String(), returnQuantity: t.Number() }))),
        exchangeItems: t.Array(t.Object({ productCode: t.String(), quantity: t.Number({ minimum: 1 }) }), { minItems: 1 }),
        difference: t.Optional(t.Nullable(t.Number())),
        reason: t.String(),
        notes: t.Optional(t.Nullable(t.String())),
      }),
    },
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
    { query: t.Object({ filter: t.Optional(t.Nullable(t.String())) }) },
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
    { query: t.Object({ filter: t.Optional(t.Nullable(t.String())) }) },
  )
  .get(
    "/receipts/search",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      if (!query.receiptId && !query.studentCode && !query.dateFrom && !query.dateTo && !query.paymentMethod) {
        set.status = 400; return { detail: "At least one search criterion is required" };
      }
      try {
        const shopScope = hasRole(user.roles, "admin") || user.is_superuser
          ? null
          : (user as typeof user & { shop_id?: string | null }).shop_id ?? null;
        const results = await searchReceipts({
          receiptId: query.receiptId ?? null,
          studentCode: query.studentCode ?? null,
          dateFrom: query.dateFrom ?? null,
          dateTo: query.dateTo ?? null,
          paymentMethod: query.paymentMethod ?? null,
          shopId: shopScope,
        });
        if (results.length === 0) {
          set.status = 404; return { detail: "Receipt not found" };
        }
        return {
          receipts: results,
          receipt: results.length === 1 ? results[0] : null,
        };
      } catch (e) { return handle(set)(e); }
    },
    {
      query: t.Object({
        receiptId: t.Optional(t.Nullable(t.String())),
        studentCode: t.Optional(t.Nullable(t.String())),
        dateFrom: t.Optional(t.Nullable(t.String())),
        dateTo: t.Optional(t.Nullable(t.String())),
        paymentMethod: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .get(
    "/exchange/products",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager", "cashier")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        return await getExchangeProducts({
          shopId: query.shop_id ?? null,
          inStock: query.inStock !== "false",
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      query: t.Object({
        inStock: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .get(
    "/refund/candidates",
    async ({ user, set }) => {
      if (!hasRole(user.roles, "admin", "refund_officer")) { set.status = 403; return { detail: "Forbidden" }; }
      try { return await listRefundCandidates(); }
      catch (e) { return handle(set)(e); }
    },
  )
  // Pre-refund family search — by famcode / student / parent identifiers.
  // Returns top-N family headers so the refund officer can pick a family
  // before drilling into the full roster.
  .get(
    "/refund/family-search",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin", "refund_officer")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        const q = query.q ?? "";
        const limit = query.limit ? Number(query.limit) : 10;
        const items = await searchRefundFamilies(q, limit);
        return { query: q, items };
      } catch (e) { return handle(set)(e); }
    },
    {
      query: t.Object({
        q: t.String({ minLength: 2, maxLength: 100 }),
        limit: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  // Full family roster — every member of `family_code`, including inactive,
  // withdrawn, and graduated entries, with a read-only wallet snapshot. Used
  // for pre-refund verification.
  .get(
    "/refund/family/:family_code",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "refund_officer")) { set.status = 403; return { detail: "Forbidden" }; }
      try {
        const roster = await getRefundFamilyRoster(params.family_code);
        if (!roster) {
          set.status = 404;
          return { detail: `No members found for family_code '${params.family_code}'` };
        }
        return roster;
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ family_code: t.String({ minLength: 1, maxLength: 20 }) }) },
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
        notes: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
      }),
    },
  )
  // ── Bulk import (xlsx): template download + 3 upload variants ────────────
  .get(
    "/admin/import/template",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Admin/manager only" };
      }
      try { return await buildTemplate(query.shop_id ?? ""); }
      catch (e) { return handle(set)(e); }
    },
    { query: t.Object({ shop_id: t.Optional(t.Nullable(t.String())) }) },
  )
  .post(
    "/admin/import/products",
    async ({ body, query, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Admin/manager only" };
      }
      try {
        const result = await importProducts({
          caller: user as typeof user & { shop_id?: string | null },
          file: body.file,
          shopId: query.shop_id ?? "",
        });
        set.status = result.status;
        return result.body;
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({ file: t.File() }),
      query: t.Object({ shop_id: t.Optional(t.Nullable(t.String())) }),
    },
  )
  .post(
    "/admin/import/stock-receive",
    async ({ body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Admin/manager only" };
      }
      try {
        const result = await importStockReceive({
          caller: user as typeof user & { shop_id?: string | null },
          file: body.file,
        });
        set.status = result.status;
        return result.body;
      } catch (e) { return handle(set)(e); }
    },
    { body: t.Object({ file: t.File() }) },
  )
  .post(
    "/admin/import/store",
    async ({ body, query, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Admin/manager only" };
      }
      try {
        const result = await importStore({
          caller: user as typeof user & { shop_id?: string | null },
          file: body.file,
          shopId: query.shop_id ?? "",
        });
        set.status = result.status;
        return result.body;
      } catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({ file: t.File() }),
      query: t.Object({ shop_id: t.Optional(t.Nullable(t.String())) }),
    },
  )
  // ── Admin wallet reports (adjustment + transfer) ─────────────────────────
  .get(
    "/admin/adjustment-report",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      try {
        return await adjustmentReport({
          dateFrom: query.date_from ?? null,
          dateTo: query.date_to ?? null,
          direction: query.direction ?? null,
          typeFilter: query.type ?? null,
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      query: t.Object({
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        direction: t.Optional(t.Nullable(t.String())),
        type: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .get(
    "/admin/transfer-report",
    async ({ query, user, set }) => {
      if (!hasRole(user.roles, "admin")) { set.status = 403; return { detail: "Admin only" }; }
      const page = query.page ? Math.max(Number(query.page), 1) : 1;
      const pageSize = query.page_size ? Math.min(Math.max(Number(query.page_size), 1), 200) : 20;
      try {
        return await transferReport({
          dateFrom: query.date_from ?? null,
          dateTo: query.date_to ?? null,
          page, pageSize,
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      query: t.Object({
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  // ── Topup intent + status + parent-confirm (mock QR; PYMT methods 501) ──
  .post(
    "/wallets/:id/topup",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "parent", "staff", "admin", "cashier", "manager", "kitchen", "student")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid wallet id" }; }
      try {
        if (!(await userCanAccessWallet(user, id))) {
          set.status = 403; return { detail: "Not authorized" };
        }
        return await createTopupIntent({
          walletId: id,
          amount: body.amount,
          userId: Number(user.sub),
          notes: body.notes ?? null,
          paymentMethod: body.payment_method ?? undefined,
          remark: body.remark ?? null,
          payType: body.pay_type ?? null,
          lang: body.lang ?? null,
        });
      } catch (e) { return handle(set)(e); }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        amount: t.Number({ exclusiveMinimum: 0 }),
        notes: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
        payment_method: t.Optional(t.Nullable(t.String())),
        remark: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
        pay_type: t.Optional(t.Nullable(t.Union([t.Literal("N"), t.Literal("H")]))),
        lang: t.Optional(t.Nullable(t.Union([t.Literal("T"), t.Literal("E")]))),
      }),
    },
  )
  .get(
    "/wallets/topup/:refCode/status",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "parent", "staff", "admin", "cashier", "manager", "kitchen", "student")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      try {
        const { intent, walletId } = await getTopupStatus(params.refCode);
        if (!(await userCanAccessWallet(user, walletId))) {
          set.status = 403; return { detail: "Not authorized" };
        }
        return intent;
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ refCode: t.String() }) },
  )
  .post(
    "/wallets/topup/:refCode/parent-confirm",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "parent", "staff", "cashier", "manager", "kitchen", "student")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      try {
        const { walletId } = await getTopupStatus(params.refCode);
        if (!(await userCanAccessWallet(user, walletId))) {
          set.status = 403; return { detail: "Not authorized" };
        }
        return await confirmTopup({
          refCode: params.refCode,
          confirmerId: Number(user.sub),
          confirmedVia: "parent_self",
        });
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ refCode: t.String() }) },
  )
  // Force-sync against BAY (PYMT inquiry). Useful when the gateway webhook
  // is late and the EASYPay landing page wants to know status right now,
  // or when a cashier polling the QR wants a second opinion before giving up.
  .post(
    "/wallets/topup/:refCode/inquiry",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "parent", "staff", "admin", "cashier", "manager", "kitchen", "student")) {
        set.status = 403; return { detail: "Forbidden" };
      }
      try {
        const { walletId } = await getTopupStatus(params.refCode);
        if (!(await userCanAccessWallet(user, walletId))) {
          set.status = 403; return { detail: "Not authorized" };
        }
        return await inquireTopupFromGateway(params.refCode);
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ refCode: t.String() }) },
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
        notes: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
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
        reference_ticket: t.Optional(t.Nullable(t.String({ maxLength: 50 }))),
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
        limit: t.Optional(t.Nullable(t.String())),
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
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
        threshold: t.Optional(t.Nullable(t.Number())),
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
        relation: t.Optional(t.Nullable(t.String())),
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
  .use(cors({
    origin: config.corsOrigins.length === 1 && config.corsOrigins[0] === "*"
      ? true
      : config.corsOrigins,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }))
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 422;
      return { detail: error.message };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { detail: "Not found" };
    }
    // Intentional 401/403 from auth/role middlewares — don't spam logs.
    if (set.status === 401 || set.status === 403) {
      return { detail: error instanceof Error ? error.message : "Unauthorized" };
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
        full_name: t.Optional(t.Nullable(t.String())),
        provider: t.Optional(t.Nullable(t.String())),
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
  // Public GET — see comment in the authed group above for rationale.
  .get("/api/v1/admin/settings/school", async () => await getSchoolSettings())
  // BAY webhook — public (gateway-to-server, no JWT) but signed via HMAC.
  //
  // Now that this endpoint can create POS receipts (not just credit wallets),
  // an attacker who can guess a ref_code could spoof a COMPLETED callback and
  // get free goods + drained stock. We require an HMAC-SHA256 signature of
  // the raw body, keyed on PYMT_WEBHOOK_SECRET, sent in the X-PYMT-Signature
  // header as `sha256=<hex>`. Timing-safe compare against the expected
  // value. If PYMT_WEBHOOK_SECRET is unset we log a loud warning and accept
  // the body (dev/UAT only — production must set the secret).
  .post(
    "/api/v1/bay/callback",
    async ({ body, request, set }) => {
      const secret = process.env.PYMT_WEBHOOK_SECRET ?? "";
      if (secret) {
        const provided = request.headers.get("x-pymt-signature") ?? "";
        if (!provided) {
          set.status = 401;
          return { detail: "Missing X-PYMT-Signature header" };
        }
        // jsonbinary parity: re-serialize body the way Elysia gives it so the
        // HMAC matches what PYMT signed. PYMT signs the JSON body bytes.
        const raw = JSON.stringify(body);
        const hasher = new Bun.CryptoHasher("sha256", secret);
        hasher.update(raw);
        const expectedHex = hasher.digest("hex");
        const expected = `sha256=${expectedHex}`;
        // Timing-safe compare
        const a = new TextEncoder().encode(expected);
        const b = new TextEncoder().encode(provided);
        let diff = a.length ^ b.length;
        for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a[i] ^ b[i];
        if (diff !== 0) {
          set.status = 401;
          return { detail: "Invalid signature" };
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn("[bay/callback] PYMT_WEBHOOK_SECRET not set — accepting unsigned webhook (dev only)");
      }
      try { return await handleBayCallback(body); }
      catch (e) { return handle(set)(e); }
    },
    {
      body: t.Object({
        transactionNo: t.Optional(t.Nullable(t.String())),
        reference1: t.Optional(t.Nullable(t.String())),
        reference2: t.Optional(t.Nullable(t.String())),
        orderRef: t.Optional(t.Nullable(t.String())),
        amount: t.Number(),
        status: t.Union([t.Literal("COMPLETED"), t.Literal("FAILED")]),
      }),
    },
  )
  // Customer display — public (no auth), display window has no login
  .get("/api/v1/customer-display/images", async () => await listImages())
  .get(
    "/api/v1/customer-display/images/:id/binary",
    async ({ params, set }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id)) { set.status = 422; return { detail: "Invalid id" }; }
      try {
        const bin = await getImageBinary(id);
        set.headers["Content-Type"] = bin.contentType;
        set.headers["Cache-Control"] = "public, max-age=3600";
        set.headers["Content-Length"] = String(bin.sizeBytes);
        return bin.content;
      } catch (e) { return handle(set)(e); }
    },
    { params: t.Object({ id: t.String() }) },
  )
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
      // ── User × Role (admin only): list / assign / remove secondary roles ──
      .get(
        "/auth/users/:user_id/roles",
        async ({ params, user, set }) => {
          if (!hasRole(user.roles, "admin")) {
            set.status = 403;
            return { detail: "Admin only" };
          }
          const id = Number(params.user_id);
          if (!Number.isInteger(id)) {
            set.status = 422;
            return { detail: "Invalid user id" };
          }
          try { return await listUserRoles(id); }
          catch (e) { return handle(set)(e); }
        },
        { params: t.Object({ user_id: t.String() }) },
      )
      .post(
        "/auth/users/:user_id/roles",
        async ({ params, body, user, set }) => {
          if (!hasRole(user.roles, "admin")) {
            set.status = 403;
            return { detail: "Admin only" };
          }
          const id = Number(params.user_id);
          if (!Number.isInteger(id)) {
            set.status = 422;
            return { detail: "Invalid user id" };
          }
          try {
            set.status = 201;
            return await assignRoleToUser(id, body.role_name);
          } catch (e) {
            return handle(set)(e);
          }
        },
        {
          params: t.Object({ user_id: t.String() }),
          body: t.Object({ role_name: t.String() }),
        },
      )
      .delete(
        "/auth/users/:user_id/roles/:role_name",
        async ({ params, user, set }) => {
          if (!hasRole(user.roles, "admin")) {
            set.status = 403;
            return { detail: "Admin only" };
          }
          const id = Number(params.user_id);
          if (!Number.isInteger(id)) {
            set.status = 422;
            return { detail: "Invalid user id" };
          }
          try {
            return await removeRoleFromUser(id, decodeURIComponent(params.role_name));
          } catch (e) {
            return handle(set)(e);
          }
        },
        { params: t.Object({ user_id: t.String(), role_name: t.String() }) },
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
