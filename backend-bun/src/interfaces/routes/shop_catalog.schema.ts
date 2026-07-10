import { t } from "elysia";

const shopIdParams = t.Object({ shopId: t.String() });
const shopBundleParams = t.Object({ shopId: t.String(), bundleId: t.String() });
const shopProductParams = t.Object({ shopId: t.String(), productId: t.String() });
const shopCategoryParams = t.Object({ shopId: t.String(), categoryId: t.String() });
const shopPanelParams = t.Object({ shopId: t.String(), panelId: t.String() });
const shopPanelProductParams = t.Object({
    shopId: t.String(),
    panelId: t.String(),
    productId: t.String(),
});
const shopPanelBundleParams = t.Object({
    shopId: t.String(),
    panelId: t.String(),
    bundleId: t.String(),
});

const shopsTag = { tags: ["Shops"] };

const panelItemBody = t.Object({
    price: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
    short_name: t.Optional(t.Nullable(t.String())),
    included: t.Optional(t.Nullable(t.Boolean())),
});

const bundleItem = t.Object({ product_id: t.Number(), quantity: t.Number({ minimum: 1 }) });

export const listBundles = {
    params: shopIdParams,
    query: t.Object({ include_inactive: t.Optional(t.Nullable(t.String())) }),
    detail: { ...shopsTag, summary: "List bundles in a shop" },
};

export const getBundle = {
    params: shopBundleParams,
    detail: { ...shopsTag, summary: "Get one bundle" },
};

export const createBundle = {
    params: shopIdParams,
    body: t.Object({
        bundle_code: t.String({ minLength: 1, maxLength: 50 }),
        barcode: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
        name: t.String({ minLength: 1, maxLength: 255 }),
        description: t.Optional(t.Nullable(t.String())),
        external_price: t.Number({ minimum: 0 }),
        internal_price: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        color: t.Optional(t.Nullable(t.String())),
        items: t.Array(bundleItem),
    }),
    detail: { ...shopsTag, summary: "Create a bundle" },
};

export const updateBundle = {
    params: shopBundleParams,
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
        items: t.Optional(t.Nullable(t.Array(bundleItem))),
    }),
    detail: { ...shopsTag, summary: "Update a bundle" },
};

export const deleteBundle = {
    params: shopBundleParams,
    detail: { ...shopsTag, summary: "Delete a bundle" },
};

export const reorderBundles = {
    params: shopIdParams,
    body: t.Object({ sort_map: t.Record(t.String(), t.Number()) }),
    detail: { ...shopsTag, summary: "Reorder bundles" },
};

export const checkBundleStock = {
    params: shopBundleParams,
    detail: { ...shopsTag, summary: "Check bundle component stock availability" },
};

export const listPricePanels = {
    params: shopIdParams,
    detail: { ...shopsTag, summary: "List price panels for a shop" },
};

export const createPricePanel = {
    params: shopIdParams,
    body: t.Object({ name: t.String({ minLength: 1 }), color: t.Optional(t.Nullable(t.String())) }),
    detail: { ...shopsTag, summary: "Create a price panel" },
};

export const updatePricePanel = {
    params: shopPanelParams,
    body: t.Object({
        name: t.Optional(t.Nullable(t.String())),
        color: t.Optional(t.Nullable(t.String())),
        sort_order: t.Optional(t.Nullable(t.Number())),
    }),
    detail: { ...shopsTag, summary: "Update a price panel" },
};

export const deletePricePanel = {
    params: shopPanelParams,
    detail: { ...shopsTag, summary: "Delete a price panel" },
};

export const getPricePanelItems = {
    params: shopPanelParams,
    detail: { ...shopsTag, summary: "List items in a price panel" },
};

export const setPricePanelItemPrice = {
    params: shopPanelProductParams,
    body: panelItemBody,
    detail: { ...shopsTag, summary: "Set product price on a price panel" },
};

export const setPricePanelBundleItemPrice = {
    params: shopPanelBundleParams,
    body: panelItemBody,
    detail: { ...shopsTag, summary: "Set bundle price on a price panel" },
};

export const createShopProduct = {
    params: shopIdParams,
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
    detail: { ...shopsTag, summary: "Create a shop product" },
};

export const updateShopProduct = {
    params: shopProductParams,
    body: t.Object({
        product_code: t.Optional(t.Nullable(t.String())),
        barcode: t.Optional(t.Nullable(t.String())),
        name: t.Optional(t.Nullable(t.String())),
        category: t.Optional(t.Nullable(t.String())),
        external_price: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        internal_price: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        avg_cost: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        vat_percent: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 100 }))),
        min_stock: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        is_active: t.Optional(t.Nullable(t.Boolean())),
        photo_url: t.Optional(t.Nullable(t.String())),
        color: t.Optional(t.Nullable(t.String())),
        uom_id: t.Optional(t.Nullable(t.Number())),
        short_name: t.Optional(t.Nullable(t.String())),
        sort_order: t.Optional(t.Nullable(t.Number())),
    }),
    detail: { ...shopsTag, summary: "Update a shop product" },
};

export const deleteShopProduct = {
    params: shopProductParams,
    detail: { ...shopsTag, summary: "Delete a shop product" },
};

export const receiveStock = {
    params: shopIdParams,
    body: t.Object({
        items: t.Array(
            t.Object({
                product_id: t.Number(),
                qty: t.Number(),
                cost_per_unit: t.Number({ minimum: 0 }),
                po: t.Optional(t.Nullable(t.String())),
                invoice: t.Optional(t.Nullable(t.String())),
                note: t.Optional(t.Nullable(t.String())),
            }),
            { minItems: 1 },
        ),
    }),
    detail: { ...shopsTag, summary: "Receive stock into a shop" },
};

export const adjustStock = {
    params: shopIdParams,
    body: t.Object({
        product_id: t.Number(),
        delta: t.Number(),
        reason: t.String({ minLength: 1 }),
        cost_per_unit: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
    }),
    detail: { ...shopsTag, summary: "Adjust stock for a product" },
};

export const createShopCategory = {
    params: shopIdParams,
    body: t.Object({ name: t.String({ minLength: 1, maxLength: 100 }) }),
    detail: { ...shopsTag, summary: "Create a shop category" },
};

export const updateShopCategory = {
    params: shopCategoryParams,
    body: t.Object({ name: t.String({ minLength: 1, maxLength: 100 }) }),
    detail: { ...shopsTag, summary: "Rename a shop category" },
};

export const deleteShopCategory = {
    params: shopCategoryParams,
    detail: { ...shopsTag, summary: "Delete a shop category" },
};
