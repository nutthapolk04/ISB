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
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

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
        module: t.Optional(t.Union([t.Literal("canteen"), t.Literal("store")])),
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
  );
