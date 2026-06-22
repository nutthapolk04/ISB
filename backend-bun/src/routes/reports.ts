import { Elysia, t } from "elysia";
import { requireAuth } from "@/middleware/auth";
import {
  salesReport,
  salesByPaymentReport,
  stockReport,
  returnsReport,
  stockCardReport,
  salesSummaryReport,
  salesByItemReport,
} from "@/services/report_service";

function handleScopeError(set: { status?: number }) {
  return (e: unknown) => {
    const err = e as { status?: number; message?: string };
    if (err.status && err.status >= 400 && err.status < 500) {
      set.status = err.status;
      return { detail: err.message ?? "Bad request" };
    }
    throw e;
  };
}

export const reportRoutes = new Elysia({ name: "reports", prefix: "/reports" })
  .use(requireAuth)
  .get(
    "/sales",
    async ({ query, user, set }) => {
      try {
        return await salesReport({
          user,
          dateFrom: query.date_from,
          dateTo: query.date_to,
          shopId: query.shop_id,
          module: query.module,
        });
      } catch (e) {
        return handleScopeError(set)(e);
      }
    },
    {
      query: t.Object({
        date_from: t.String(),
        date_to: t.String(),
        shop_id: t.Optional(t.Nullable(t.String())),
        module: t.Optional(t.Nullable(t.String())),
      }),
      detail: { summary: "Sales aggregated by product" },
    },
  )
  .get(
    "/sales-by-payment",
    async ({ query, user, set }) => {
      try {
        return await salesByPaymentReport({
          user,
          dateFrom: query.date_from,
          dateTo: query.date_to,
          shopId: query.shop_id,
          module: query.module,
        });
      } catch (e) {
        return handleScopeError(set)(e);
      }
    },
    {
      query: t.Object({
        date_from: t.String(),
        date_to: t.String(),
        shop_id: t.Optional(t.Nullable(t.String())),
        module: t.Optional(t.Nullable(t.String())),
      }),
      detail: { summary: "Sales grouped by payment method with retail/department split" },
    },
  )
  .get(
    "/stock",
    async ({ query, user, set }) => {
      try {
        return await stockReport({
          user,
          shopId: query.shop_id,
          module: query.module,
        });
      } catch (e) {
        return handleScopeError(set)(e);
      }
    },
    {
      query: t.Object({
        shop_id: t.Optional(t.Nullable(t.String())),
        module: t.Optional(t.Nullable(t.String())),
      }),
      detail: { summary: "Current stock per active product per shop" },
    },
  )
  .get(
    "/returns",
    async ({ query, user, set }) => {
      try {
        return await returnsReport({
          user,
          dateFrom: query.date_from,
          dateTo: query.date_to,
          shopId: query.shop_id,
          module: query.module,
        });
      } catch (e) {
        return handleScopeError(set)(e);
      }
    },
    {
      query: t.Object({
        date_from: t.String(),
        date_to: t.String(),
        shop_id: t.Optional(t.Nullable(t.String())),
        module: t.Optional(t.Nullable(t.String())),
      }),
      detail: { summary: "Returns within date range with refund/exchange totals" },
    },
  )
  .get(
    "/stock-card",
    async ({ query, user, set }) => {
      try {
        console.log("[SC route] raw query=", JSON.stringify(query));
        return await stockCardReport({
          user,
          dateFrom: query.date_from,
          dateTo: query.date_to,
          shopId: query.shop_id,
          productVariantId: query.product_variant_id ? Number(query.product_variant_id) : undefined,
          productSearch: query.product_search || undefined,
          category: query.category || undefined,
          includeEmpty: query.include_empty === "true",
        });
      } catch (e) {
        return handleScopeError(set)(e);
      }
    },
    {
      query: t.Object({
        date_from: t.String(),
        date_to: t.String(),
        shop_id: t.Optional(t.Nullable(t.String())),
        product_variant_id: t.Optional(t.Nullable(t.String())),
        product_search: t.Optional(t.String()),
        category: t.Optional(t.String()),
        include_empty: t.Optional(t.String()),
      }),
      detail: {
        summary: "Per-product stock card with opening/closing balances",
        description: "shop_id required; product_variant_id optional to scope to a single SKU.",
      },
    },
  )
  .get(
    "/sales-summary",
    async ({ query, user, set }) => {
      try {
        return await salesSummaryReport({
          user,
          dateFrom: query.date_from,
          dateTo: query.date_to,
          customerType: query.customer_type,
          userName: query.user_name,
          familyCode: query.family_code,
          receiptNoFrom: query.receipt_no_from,
          receiptNoTo: query.receipt_no_to,
          receiveType: query.receive_type,
          shopId: query.shop_id,
          module: query.module,
        });
      } catch (e) {
        return handleScopeError(set)(e);
      }
    },
    {
      query: t.Object({
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        customer_type: t.Optional(t.Nullable(t.String())),
        user_name: t.Optional(t.Nullable(t.String())),
        family_code: t.Optional(t.Nullable(t.String())),
        receipt_no_from: t.Optional(t.Nullable(t.String())),
        receipt_no_to: t.Optional(t.Nullable(t.String())),
        receive_type: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        module: t.Optional(t.Nullable(t.String())),
      }),
      detail: { summary: "Per-receipt sales summary with payment-method breakdown" },
    },
  )
  .get(
    "/sales-by-item",
    async ({ query, user, set }) => {
      try {
        return await salesByItemReport({
          user,
          dateFrom: query.date_from,
          dateTo: query.date_to,
          customerType: query.customer_type,
          userName: query.user_name,
          familyCode: query.family_code,
          receiptNoFrom: query.receipt_no_from,
          receiptNoTo: query.receipt_no_to,
          receiveType: query.receive_type,
          shopId: query.shop_id,
          module: query.module,
        });
      } catch (e) {
        return handleScopeError(set)(e);
      }
    },
    {
      query: t.Object({
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        customer_type: t.Optional(t.Nullable(t.String())),
        user_name: t.Optional(t.Nullable(t.String())),
        family_code: t.Optional(t.Nullable(t.String())),
        receipt_no_from: t.Optional(t.Nullable(t.String())),
        receipt_no_to: t.Optional(t.Nullable(t.String())),
        receive_type: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        module: t.Optional(t.Nullable(t.String())),
      }),
      detail: { summary: "Per-receipt-item sales breakdown with totals" },
    },
  );
