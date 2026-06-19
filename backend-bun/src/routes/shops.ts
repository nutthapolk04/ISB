import { Elysia, t } from "elysia";
import { requireAuth, hasRole } from "@/middleware/auth";
import {
  listShops,
  getShop,
  createShop,
  updateShop,
  deleteShop,
  shopStats,
  listLowStock,
} from "@/services/shop_service";
import {
  listShopProducts,
  listShopCategories,
  listProductBarcodes,
  addProductBarcode,
  deleteProductBarcode,
  listFifoLots,
  listShopMovements,
  listShopAuditLogs,
} from "@/services/shop_product_service";
import { checkout } from "@/services/pos_checkout_service";
import {
  listCloses,
  createClose,
  getClose,
  bulkUpdateItems,
  importExcel,
  exportExcel,
  confirmClose,
} from "@/services/close_month_service";
import { getMonthlyStockReport, exportMonthlyStockReport } from "@/services/monthly_stock_service";
import { db } from "@/db/client";
import { users, shops as shopsTable, shopProducts, productOrderHistory } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

type SetLike = { status?: number | string };

function handleErr(set: SetLike, e: unknown): { detail: string } | never {
  const err = e as { status?: number; message?: string };
  if (err.status && err.status >= 400 && err.status < 500) {
    set.status = err.status;
    return { detail: err.message ?? "Bad request" };
  }
  throw e;
}

export const shopRoutes = new Elysia({ name: "shops", prefix: "/shops" })
  .use(requireAuth)
  .get(
    "/",
    async ({ query }) => {
      const activeOnly = query.active_only !== "false";
      const module =
        query.module === "canteen" || query.module === "store"
          ? query.module
          : undefined;
      return await listShops({ activeOnly, module });
    },
    {
      query: t.Object({
        active_only: t.Optional(t.Nullable(t.String())),
        module: t.Optional(t.Nullable(t.String())),
      }),
      detail: {
        summary: "List shops",
        description:
          "Active shops by default. Filter by module (canteen|store). Mirrors FastAPI /api/v1/shops/.",
      },
    },
  )
  .post(
    "/",
    async ({ body, user, set }) => {
      if (!user.is_superuser) {
        set.status = 403;
        return { detail: "Admin only" };
      }
      try {
        set.status = 201;
        return await createShop(body);
      } catch (e) {
        return handleErr(set, e);
      }
    },
    {
      body: t.Object({
        id: t.String({ minLength: 1, maxLength: 50 }),
        name: t.String({ minLength: 1, maxLength: 100 }),
        shop_type: t.Optional(t.Union([t.Literal("avg_cost"), t.Literal("fifo")])),
        description: t.Optional(t.Nullable(t.String())),
        allow_department_charge: t.Optional(t.Nullable(t.Boolean())),
        module: t.Optional(t.Union([t.Literal("canteen"), t.Literal("store")])),
        uses_dual_pricing: t.Optional(t.Nullable(t.Boolean())),
        spending_group_id: t.Optional(t.Nullable(t.Number())),
      }),
      detail: { summary: "Create a shop (admin)" },
    },
  )
  .get(
    "/low-stock",
    async ({ set }) => {
      try { return await listLowStock(); }
      catch (e) { return handleErr(set, e); }
    },
    {
      detail: {
        summary: "All low-stock products across active shops",
      },
    },
  )
  .get(
    "/:shopId",
    async ({ params, set }) => {
      const shop = await getShop(params.shopId);
      if (!shop) {
        set.status = 404;
        return { detail: "Shop not found" };
      }
      return shop;
    },
    {
      params: t.Object({ shopId: t.String() }),
      detail: { summary: "Get one shop by id" },
    },
  )
  .patch(
    "/:shopId",
    async ({ params, body, user, set }) => {
      if (!user.is_superuser) {
        set.status = 403;
        return { detail: "Admin only" };
      }
      try { return await updateShop(params.shopId, body); }
      catch (e) { return handleErr(set, e); }
    },
    {
      params: t.Object({ shopId: t.String() }),
      body: t.Object({
        name: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 100 }))),
        description: t.Optional(t.Nullable(t.String())),
        is_active: t.Optional(t.Nullable(t.Boolean())),
        allow_department_charge: t.Optional(t.Nullable(t.Boolean())),
        module: t.Optional(t.Nullable(t.Union([t.Literal("canteen"), t.Literal("store")]))),
        uses_dual_pricing: t.Optional(t.Nullable(t.Boolean())),
        spending_group_id: t.Optional(t.Nullable(t.Number())),
        receipt_header: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
        receipt_footer: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
      }),
      detail: { summary: "Update a shop (admin)" },
    },
  )
  .delete(
    "/:shopId",
    async ({ params, user, set }) => {
      if (!user.is_superuser) {
        set.status = 403;
        return { detail: "Admin only" };
      }
      try { return await deleteShop(params.shopId); }
      catch (e) { return handleErr(set, e); }
    },
    {
      params: t.Object({ shopId: t.String() }),
      detail: { summary: "Delete a shop (soft if receipts exist)" },
    },
  )
  .get(
    "/:shopId/stats",
    async ({ params, set }) => {
      try { return await shopStats(params.shopId); }
      catch (e) { return handleErr(set, e); }
    },
    {
      params: t.Object({ shopId: t.String() }),
      detail: { summary: "Shop KPI stats" },
    },
  )
  .get(
    "/:shopId/products",
    async ({ params, query, set }) => {
      try {
        return await listShopProducts(params.shopId, {
          search: query.search,
          category: query.category,
          includeInactive: query.include_inactive === "true",
        });
      } catch (e) {
        return handleErr(set, e);
      }
    },
    {
      params: t.Object({ shopId: t.String() }),
      query: t.Object({
        search: t.Optional(t.Nullable(t.String())),
        category: t.Optional(t.Nullable(t.String())),
        include_inactive: t.Optional(t.Nullable(t.String())),
      }),
      detail: {
        summary: "List products in a shop",
        description:
          "Active products by default, sorted by sort_order then name. Supports text search and category filter.",
      },
    },
  )
  .get(
    "/:shopId/categories",
    async ({ params, set }) => {
      try { return await listShopCategories(params.shopId); }
      catch (e) { return handleErr(set, e); }
    },
    {
      params: t.Object({ shopId: t.String() }),
      detail: { summary: "List categories in a shop" },
    },
  )
  .get(
    "/:shopId/products/:productId/barcodes",
    async ({ params, set }) => {
      const pid = Number(params.productId);
      if (!Number.isInteger(pid)) { set.status = 422; return { detail: "Invalid product id" }; }
      try { return await listProductBarcodes(params.shopId, pid); }
      catch (e) { return handleErr(set, e); }
    },
    {
      params: t.Object({ shopId: t.String(), productId: t.String() }),
      detail: { summary: "List extra barcodes for a product" },
    },
  )
  .post(
    "/:shopId/products/:productId/barcodes",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Insufficient role" };
      }
      const pid = Number(params.productId);
      if (!Number.isInteger(pid)) { set.status = 422; return { detail: "Invalid product id" }; }
      try {
        set.status = 201;
        return await addProductBarcode({
          shopId: params.shopId,
          productId: pid,
          barcode: body.barcode,
          label: body.label ?? null,
        });
      } catch (e) { return handleErr(set, e); }
    },
    {
      params: t.Object({ shopId: t.String(), productId: t.String() }),
      body: t.Object({
        barcode: t.String({ minLength: 1, maxLength: 100 }),
        label: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
      }),
      detail: { summary: "Add an extra barcode to a product" },
    },
  )
  .delete(
    "/:shopId/products/:productId/barcodes/:barcodeId",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Insufficient role" };
      }
      const pid = Number(params.productId);
      const bid = Number(params.barcodeId);
      if (!Number.isInteger(pid) || !Number.isInteger(bid)) {
        set.status = 422;
        return { detail: "Invalid id" };
      }
      try {
        await deleteProductBarcode({ shopId: params.shopId, productId: pid, barcodeId: bid });
        set.status = 204;
        return null;
      } catch (e) { return handleErr(set, e); }
    },
    {
      params: t.Object({ shopId: t.String(), productId: t.String(), barcodeId: t.String() }),
      detail: { summary: "Delete an extra barcode" },
    },
  )
  .get(
    "/:shopId/products/:productId/fifo-lots",
    async ({ params, set }) => {
      const pid = Number(params.productId);
      if (!Number.isInteger(pid)) { set.status = 422; return { detail: "Invalid product id" }; }
      try { return await listFifoLots(params.shopId, pid); }
      catch (e) { return handleErr(set, e); }
    },
    {
      params: t.Object({ shopId: t.String(), productId: t.String() }),
      detail: { summary: "FIFO lots for a product (FIFO shops only)" },
    },
  )
  .get(
    "/:shopId/movements",
    async ({ params, query, set }) => {
      try {
        return await listShopMovements(params.shopId, {
          productId: query.product_id ? Number(query.product_id) : undefined,
          type: query.type,
          limit: query.limit ? Math.min(Math.max(Number(query.limit), 1), 1000) : undefined,
        });
      } catch (e) { return handleErr(set, e); }
    },
    {
      params: t.Object({ shopId: t.String() }),
      query: t.Object({
        product_id: t.Optional(t.Nullable(t.String())),
        type: t.Optional(t.Nullable(t.String())),
        limit: t.Optional(t.Nullable(t.String())),
      }),
      detail: { summary: "Stock movements (most recent first)" },
    },
  )
  .get(
    "/:shopId/audit-logs",
    async ({ params, query, set }) => {
      try {
        return await listShopAuditLogs(params.shopId, {
          action: query.action,
          limit: query.limit ? Math.min(Math.max(Number(query.limit), 1), 200) : undefined,
          offset: query.offset ? Math.max(Number(query.offset), 0) : undefined,
        });
      } catch (e) { return handleErr(set, e); }
    },
    {
      params: t.Object({ shopId: t.String() }),
      query: t.Object({
        action: t.Optional(t.Nullable(t.String())),
        limit: t.Optional(t.Nullable(t.String())),
        offset: t.Optional(t.Nullable(t.String())),
      }),
      detail: { summary: "Audit log entries for this shop" },
    },
  )
  .post(
    "/:shopId/requisition",
    async ({ params, body, user, set }) => {
      try {
        const shop = await getShop(params.shopId);
        if (!shop) { set.status = 404; return { detail: "Shop not found" }; }

        // Validate requester user exists and is active
        const reqRows = await db
          .select({ id: users.id, isActive: users.isActive })
          .from(users)
          .where(eq(users.id, body.requester_user_id))
          .limit(1);
        if (!reqRows[0]) { set.status = 404; return { detail: "Requester not found" }; }
        if (!reqRows[0].isActive) { set.status = 400; return { detail: "Requester is not active" }; }

        if (body.pay_mode === "department") {
          if (!body.payer_department_id) {
            set.status = 422;
            return { detail: "Department charge requires payer_department_id" };
          }
          if (!shop.allow_department_charge) {
            set.status = 400;
            return { detail: `Shop '${params.shopId}' does not accept department charges` };
          }
        }

        // POSService.checkout handles items + stock movements. Look up products to
        // honor real catalog price unless free-mode (then price_override=0).
        // We let checkout do the product lookup — provide unit_price=0 here and
        // rely on price_override behavior. To match FastAPI, pre-resolve price.
        const { db: db2 } = await import("@/db/client");
        const { shopProducts: sp } = await import("@/db/schema");
        const { eq: eqOp } = await import("drizzle-orm");
        const items: Array<{
          product_variant_id: number;
          quantity: number;
          unit_price: number;
          discount: number;
          options: never[];
          price_override?: number;
          is_bundle?: boolean;
          bundle_id?: number | null;
        }> = [];
        for (const line of body.items) {
          const p = await db2.select().from(sp).where(eqOp(sp.id, line.product_id)).limit(1);
          if (!p[0] || p[0].shopId !== params.shopId) {
            set.status = 404;
            return { detail: `Product ${line.product_id} not found in shop '${params.shopId}'` };
          }
          const internal = p[0].internalPrice != null ? Number(p[0].internalPrice) : null;
          const external = p[0].externalPrice != null ? Number(p[0].externalPrice) : 0;
          const unitPrice = internal ?? external;
          const item: {
            product_variant_id: number;
            quantity: number;
            unit_price: number;
            discount: number;
            options: never[];
            price_override?: number;
          } = {
            product_variant_id: p[0].id,
            quantity: line.qty,
            unit_price: unitPrice,
            discount: 0,
            options: [],
          };
          if (body.pay_mode === "free") item.price_override = 0;
          items.push(item);
        }

        let paymentMethod: string;
        let payerKind: "user" | "department";
        let payerUserId: number | null;
        let payerDepartmentId: number | null;
        if (body.pay_mode === "free") {
          paymentMethod = "cash";
          payerKind = "user";
          payerUserId = null;
          payerDepartmentId = null;
        } else if (body.pay_mode === "department") {
          paymentMethod = "department";
          payerKind = "department";
          payerUserId = null;
          payerDepartmentId = body.payer_department_id ?? null;
        } else {
          paymentMethod = "wallet";
          payerKind = "user";
          payerUserId = body.requester_user_id;
          payerDepartmentId = null;
        }

        set.status = 201;
        return await checkout({
          transaction_mode: "INTERNAL_ISSUE",
          payment_method: paymentMethod,
          items,
          userId: Number(user.sub),
          customer_id: null,
          payer_kind: payerKind,
          payer_user_id: payerUserId,
          payer_department_id: payerDepartmentId,
          requester_user_id: body.requester_user_id,
          notes: body.notes ?? null,
          shop_id: params.shopId,
        });
      } catch (e) { return handleErr(set, e); }
    },
    {
      params: t.Object({ shopId: t.String() }),
      body: t.Object({
        items: t.Array(
          t.Object({ product_id: t.Number(), qty: t.Number({ minimum: 1 }) }),
          { minItems: 1 },
        ),
        requester_user_id: t.Number(),
        pay_mode: t.Union([t.Literal("free"), t.Literal("department"), t.Literal("wallet")]),
        payer_department_id: t.Optional(t.Nullable(t.Number())),
        notes: t.Optional(t.Nullable(t.String())),
      }),
      detail: { summary: "Internal requisition (เบิกของ) — checkout in internal_issue mode" },
    },
  )
  // ── Product reorder (optimistic-concurrency) ──────────────────────────
  .post(
    "/:shopId/products/reorder",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403; return { detail: "Admin/manager only" };
      }
      const shop = await db
        .select({ id: shopsTable.id, productsOrderVersion: shopsTable.productsOrderVersion })
        .from(shopsTable)
        .where(eq(shopsTable.id, params.shopId))
        .limit(1);
      if (!shop[0]) { set.status = 404; return { detail: "Shop not found" }; }

      const currentVersion = shop[0].productsOrderVersion ?? 0;

      // Optimistic concurrency: if client version != DB version someone else
      // saved first. Return 409 with the current sorted list so the UI can
      // diff and let the user reconcile.
      if (body.version !== currentVersion) {
        const products = await db
          .select({ id: shopProducts.id, sort_order: shopProducts.sortOrder, name: shopProducts.name })
          .from(shopProducts)
          .where(eq(shopProducts.shopId, params.shopId));
        products.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
        set.status = 409;
        return {
          current_version: currentVersion,
          products: products.map((p) => ({ id: p.id, sort_order: p.sort_order, name: p.name })),
        };
      }

      // Apply sort_order values from the map (keys are string product ids).
      const sortMap: Record<string, number> = body.sort_map;
      const productIds = Object.keys(sortMap).map(Number).filter((n) => !Number.isNaN(n));
      let updated = 0;
      for (const pid of productIds) {
        const newOrder = sortMap[String(pid)];
        const result = await db
          .update(shopProducts)
          .set({ sortOrder: newOrder })
          .where(eq(shopProducts.id, pid));
        if (result.count > 0) updated++;
      }

      // Bump version + persist history
      const nextVersion = currentVersion + 1;
      await db.update(shopsTable)
        .set({ productsOrderVersion: nextVersion })
        .where(eq(shopsTable.id, params.shopId));

      await db.insert(productOrderHistory).values({
        shopId: params.shopId,
        version: nextVersion,
        sortMap: sortMap as Record<string, number>,
        changedBy: Number(user.sub),
        source: body.source ?? "drag",
      }).catch(() => { /* history is best-effort */ });

      return { version: nextVersion, updated };
    },
    {
      params: t.Object({ shopId: t.String() }),
      body: t.Object({
        version: t.Number(),
        sort_map: t.Record(t.String(), t.Number()),
        source: t.Optional(t.Nullable(t.String())),
      }),
      detail: { summary: "Bulk-update sort_order for products (optimistic concurrency)" },
    },
  )

  // ─── Monthly Stock Report ────────────────────────────────────────────────────

  .get(
    "/:shopId/monthly-stock-report",
    async ({ params, query, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      const { start_date, end_date } = query;
      if (!start_date || !end_date || !/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
        set.status = 422;
        return { detail: "Invalid date range" };
      }
      try {
        return await getMonthlyStockReport(params.shopId, start_date, end_date);
      } catch (e) {
        console.error("[monthly-stock-report] error:", e);
        return handleErr(set, e);
      }
    },
    {
      params: t.Object({ shopId: t.String() }),
      query: t.Object({ start_date: t.Optional(t.String()), end_date: t.Optional(t.String()) }),
    },
  )

  .get(
    "/:shopId/monthly-stock-report/export",
    async ({ params, query, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      const { start_date, end_date } = query;
      if (!start_date || !end_date || !/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
        set.status = 422;
        return { detail: "Invalid date range" };
      }
      try {
        const buffer = await exportMonthlyStockReport(params.shopId, start_date, end_date);
        return new Response(buffer, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="stock-report-${start_date}-to-${end_date}.xlsx"`,
          },
        });
      } catch (e) {
        return handleErr(set, e);
      }
    },
    {
      params: t.Object({ shopId: t.String() }),
      query: t.Object({ start_date: t.Optional(t.String()), end_date: t.Optional(t.String()) }),
    },
  )

  // ─── Close Month ────────────────────────────────────────────────────────────

  .get(
    "/:shopId/close-month",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      try {
        return await listCloses(params.shopId);
      } catch (e) {
        return handleErr(set, e);
      }
    },
    { params: t.Object({ shopId: t.String() }) },
  )

  .post(
    "/:shopId/close-month",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      try {
        set.status = 201;
        return await createClose(
          params.shopId,
          body.period_year,
          body.period_month,
        );
      } catch (e) {
        return handleErr(set, e);
      }
    },
    {
      params: t.Object({ shopId: t.String() }),
      body: t.Object({
        period_year: t.Number({ minimum: 2000, maximum: 2100 }),
        period_month: t.Number({ minimum: 1, maximum: 12 }),
      }),
    },
  )

  .get(
    "/:shopId/close-month/:closeId",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      const id = parseInt(params.closeId);
      if (!Number.isInteger(id)) {
        set.status = 422;
        return { detail: "Invalid close id" };
      }
      try {
        const close = await getClose(id);
        if (close.shop_id !== params.shopId) {
          set.status = 403;
          return { detail: "Forbidden" };
        }
        return close;
      } catch (e) {
        return handleErr(set, e);
      }
    },
    { params: t.Object({ shopId: t.String(), closeId: t.String() }) },
  )

  .patch(
    "/:shopId/close-month/:closeId/items",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      const id = parseInt(params.closeId);
      if (!Number.isInteger(id)) {
        set.status = 422;
        return { detail: "Invalid close id" };
      }
      try {
        const close = await getClose(id);
        if (close.shop_id !== params.shopId) {
          set.status = 403;
          return { detail: "Forbidden" };
        }
        await bulkUpdateItems(id, body.updates);
        return { ok: true };
      } catch (e) {
        return handleErr(set, e);
      }
    },
    {
      params: t.Object({ shopId: t.String(), closeId: t.String() }),
      body: t.Object({
        updates: t.Array(
          t.Object({ item_id: t.Number(), physical_qty: t.Number({ minimum: 0 }) }),
        ),
      }),
    },
  )

  .post(
    "/:shopId/close-month/:closeId/import-excel",
    async ({ params, body, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      const id = parseInt(params.closeId);
      if (!Number.isInteger(id)) {
        set.status = 422;
        return { detail: "Invalid close id" };
      }
      try {
        const close = await getClose(id);
        if (close.shop_id !== params.shopId) {
          set.status = 403;
          return { detail: "Forbidden" };
        }
        const buffer = await body.file.arrayBuffer();
        return await importExcel(id, buffer);
      } catch (e) {
        return handleErr(set, e);
      }
    },
    {
      params: t.Object({ shopId: t.String(), closeId: t.String() }),
      body: t.Object({ file: t.File() }),
      type: "multipart/form-data",
    },
  )

  .get(
    "/:shopId/close-month/:closeId/export-excel",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      const id = parseInt(params.closeId);
      if (!Number.isInteger(id)) {
        set.status = 422;
        return { detail: "Invalid close id" };
      }
      try {
        const close = await getClose(id);
        if (close.shop_id !== params.shopId) {
          set.status = 403;
          return { detail: "Forbidden" };
        }
        const buffer = await exportExcel(id);
        return new Response(buffer, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="close-${params.closeId}.xlsx"`,
          },
        });
      } catch (e) {
        return handleErr(set, e);
      }
    },
    { params: t.Object({ shopId: t.String(), closeId: t.String() }) },
  )

  .post(
    "/:shopId/close-month/:closeId/confirm",
    async ({ params, user, set }) => {
      if (!hasRole(user.roles, "admin", "manager")) {
        set.status = 403;
        return { detail: "Forbidden" };
      }
      const id = parseInt(params.closeId);
      if (!Number.isInteger(id)) {
        set.status = 422;
        return { detail: "Invalid close id" };
      }
      try {
        const close = await getClose(id);
        if (close.shop_id !== params.shopId) {
          set.status = 403;
          return { detail: "Forbidden" };
        }
        return await confirmClose(id, Number(user.sub));
      } catch (e) {
        return handleErr(set, e);
      }
    },
    { params: t.Object({ shopId: t.String(), closeId: t.String() }) },
  );
