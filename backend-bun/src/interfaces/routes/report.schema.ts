import { t } from "elysia";

const dateRangeQuery = {
    date_from: t.String(),
    date_to: t.String(),
    shop_id: t.Optional(t.Nullable(t.String())),
    module: t.Optional(t.Nullable(t.String())),
};

const salesFilterQuery = {
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
};

export const salesReport = {
    query: t.Object(dateRangeQuery),
    detail: { tags: ["Reports"], summary: "Sales aggregated by product" },
};

export const salesByPaymentReport = {
    query: t.Object(dateRangeQuery),
    detail: {
        tags: ["Reports"],
        summary: "Sales grouped by payment method with retail/department split",
    },
};

export const stockReport = {
    query: t.Object({
        shop_id: t.Optional(t.Nullable(t.String())),
        module: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Reports"], summary: "Current stock per active product per shop" },
};

export const returnsReport = {
    query: t.Object(dateRangeQuery),
    detail: { tags: ["Reports"], summary: "Returns within date range with refund/exchange totals" },
};

export const voidReport = {
    query: t.Object(dateRangeQuery),
    detail: { tags: ["Reports"], summary: "Voided receipts within date range" },
};

export const stockCardReport = {
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
        tags: ["Reports"],
        summary: "Per-product stock card with opening/closing balances",
        description: "shop_id required; product_variant_id optional to scope to a single SKU.",
    },
};

export const salesSummaryReport = {
    query: t.Object(salesFilterQuery),
    detail: { tags: ["Reports"], summary: "Per-receipt sales summary with payment-method breakdown" },
};

export const salesByItemReport = {
    query: t.Object(salesFilterQuery),
    detail: { tags: ["Reports"], summary: "Per-receipt-item sales breakdown with totals" },
};
