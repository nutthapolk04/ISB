import { t } from "elysia";

const shopIdParams = t.Object({ shopId: t.String() });
const shopProductParams = t.Object({ shopId: t.String(), productId: t.String() });
const shopBarcodeParams = t.Object({
    shopId: t.String(),
    productId: t.String(),
    barcodeId: t.String(),
});
const shopCloseParams = t.Object({ shopId: t.String(), closeId: t.String() });

const shopsTag = { tags: ["Shops"] };

export const listShops = {
    query: t.Object({
        active_only: t.Optional(t.Nullable(t.String())),
        module: t.Optional(t.Nullable(t.String())),
    }),
    detail: {
        ...shopsTag,
        summary: "List shops",
        description:
            "Active shops by default. Filter by module (canteen|store). Mirrors FastAPI /api/v1/shops/.",
    },
};

export const createShop = {
    body: t.Object({
        id: t.String({ minLength: 1, maxLength: 50 }),
        name: t.String({ minLength: 1, maxLength: 100 }),
        shop_type: t.Optional(t.Union([t.Literal("avg_cost"), t.Literal("fifo")])),
        description: t.Optional(t.Nullable(t.String())),
        allow_department_charge: t.Optional(t.Nullable(t.Boolean())),
        module: t.Optional(t.Union([t.Literal("canteen"), t.Literal("store")])),
        uses_dual_pricing: t.Optional(t.Nullable(t.Boolean())),
        spending_group_id: t.Optional(t.Nullable(t.Number())),
        shop_number: t.Optional(t.Nullable(t.Number({ minimum: 1, maximum: 99999 }))),
    }),
    detail: { ...shopsTag, summary: "Create a shop (admin)" },
};

export const listLowStock = {
    detail: { ...shopsTag, summary: "All low-stock products across active shops" },
};

export const getShop = {
    params: shopIdParams,
    detail: { ...shopsTag, summary: "Get one shop by id" },
};

export const updateShop = {
    params: shopIdParams,
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
        shop_number: t.Optional(t.Nullable(t.Number({ minimum: 1, maximum: 99999 }))),
    }),
    detail: { ...shopsTag, summary: "Update a shop (admin)" },
};

export const deleteShop = {
    params: shopIdParams,
    detail: { ...shopsTag, summary: "Delete a shop (soft if receipts exist)" },
};

export const updateVoidShortcuts = {
    params: shopIdParams,
    body: t.Object({
        shortcuts: t.Array(t.String({ maxLength: 60 }), { maxItems: 24 }),
    }),
    detail: { ...shopsTag, summary: "Set per-shop void receipt reason shortcuts (manager/admin)" },
};

export const shopStats = {
    params: shopIdParams,
    detail: { ...shopsTag, summary: "Shop KPI stats" },
};

export const listShopProducts = {
    params: shopIdParams,
    query: t.Object({
        search: t.Optional(t.Nullable(t.String())),
        category: t.Optional(t.Nullable(t.String())),
        include_inactive: t.Optional(t.Nullable(t.String())),
    }),
    detail: {
        ...shopsTag,
        summary: "List products in a shop",
        description:
            "Active products by default, sorted by sort_order then name. Supports text search and category filter.",
    },
};

export const listShopCategories = {
    params: shopIdParams,
    detail: { ...shopsTag, summary: "List categories in a shop" },
};

export const listProductBarcodes = {
    params: shopProductParams,
    detail: { ...shopsTag, summary: "List extra barcodes for a product" },
};

export const addProductBarcode = {
    params: shopProductParams,
    body: t.Object({
        barcode: t.String({ minLength: 1, maxLength: 100 }),
        label: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
    }),
    detail: { ...shopsTag, summary: "Add an extra barcode to a product" },
};

export const deleteProductBarcode = {
    params: shopBarcodeParams,
    detail: { ...shopsTag, summary: "Delete an extra barcode" },
};

export const listFifoLots = {
    params: shopProductParams,
    detail: { ...shopsTag, summary: "FIFO lots for a product (FIFO shops only)" },
};

export const listShopMovements = {
    params: shopIdParams,
    query: t.Object({
        product_id: t.Optional(t.Nullable(t.String())),
        type: t.Optional(t.Nullable(t.String())),
        limit: t.Optional(t.Nullable(t.String())),
    }),
    detail: { ...shopsTag, summary: "Stock movements (most recent first)" },
};

export const listShopAuditLogs = {
    params: shopIdParams,
    query: t.Object({
        action: t.Optional(t.Nullable(t.String())),
        limit: t.Optional(t.Nullable(t.String())),
        offset: t.Optional(t.Nullable(t.String())),
    }),
    detail: { ...shopsTag, summary: "Audit log entries for this shop" },
};

export const shopRequisition = {
    params: shopIdParams,
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
    detail: { ...shopsTag, summary: "Internal requisition (เบิกของ) — checkout in internal_issue mode" },
};

export const reorderShopProducts = {
    params: shopIdParams,
    body: t.Object({
        version: t.Number(),
        sort_map: t.Record(t.String(), t.Number()),
        source: t.Optional(t.Nullable(t.String())),
    }),
    detail: { ...shopsTag, summary: "Bulk-update sort_order for products (optimistic concurrency)" },
};

export const monthlyStockReport = {
    params: shopIdParams,
    query: t.Object({ start_date: t.Optional(t.String()), end_date: t.Optional(t.String()) }),
    detail: { ...shopsTag, summary: "Monthly stock report" },
};

export const exportMonthlyStockReport = {
    params: shopIdParams,
    query: t.Object({ start_date: t.Optional(t.String()), end_date: t.Optional(t.String()) }),
    detail: { ...shopsTag, summary: "Export monthly stock report (Excel)" },
};

const balanceFileQuery = t.Object({
    year: t.String(),
    month: t.Optional(t.Nullable(t.String())),
    product_id: t.Optional(t.Nullable(t.String())),
});

export const balanceFile = {
    params: shopIdParams,
    query: balanceFileQuery,
    detail: { ...shopsTag, summary: "Balance file report (average cost ledger)" },
};

export const exportBalanceFile = {
    params: shopIdParams,
    query: balanceFileQuery,
    detail: { ...shopsTag, summary: "Export balance file (Excel)" },
};

export const listCloseMonth = {
    params: shopIdParams,
    detail: { ...shopsTag, summary: "List month-close records for a shop" },
};

export const createCloseMonth = {
    params: shopIdParams,
    body: t.Object({
        period_year: t.Number({ minimum: 2000, maximum: 2100 }),
        period_month: t.Number({ minimum: 1, maximum: 12 }),
    }),
    detail: { ...shopsTag, summary: "Create a month-close record" },
};

export const getCloseMonth = {
    params: shopCloseParams,
    detail: { ...shopsTag, summary: "Get one month-close record" },
};

export const patchCloseMonthItems = {
    params: shopCloseParams,
    body: t.Object({
        updates: t.Array(
            t.Object({ item_id: t.Number(), physical_qty: t.Number({ minimum: 0 }) }),
        ),
    }),
    detail: { ...shopsTag, summary: "Bulk-update physical counts for a month-close" },
};

export const importCloseMonthExcel = {
    params: shopCloseParams,
    body: t.Object({ file: t.File() }),
    type: "multipart/form-data" as const,
    detail: { ...shopsTag, summary: "Import physical counts from Excel" },
};

export const exportCloseMonthExcel = {
    params: shopCloseParams,
    detail: { ...shopsTag, summary: "Export month-close to Excel" },
};

export const confirmCloseMonth = {
    params: shopCloseParams,
    detail: { ...shopsTag, summary: "Confirm and finalize a month-close" },
};
