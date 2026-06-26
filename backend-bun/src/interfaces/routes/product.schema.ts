import { t } from "elysia";

export const searchProducts = {
    query: t.Object({
        q: t.String({ minLength: 1 }),
        skip: t.Optional(t.Nullable(t.String())),
        limit: t.Optional(t.Nullable(t.String())),
    }),
    detail: {
        tags: ["Shops"],
        summary: "Search products by name, SKU, or barcode",
        description:
            "Exact barcode match returns first; otherwise partial match on name/SKU. Returns variant rows.",
    },
};

export const getProductByBarcode = {
    params: t.Object({ barcode: t.String() }),
    detail: { tags: ["Shops"], summary: "Get a variant by exact barcode match" },
};

export const getProductById = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["Shops"], summary: "Get product details with variants and category" },
};

export const listProducts = {
    query: t.Object({
        skip: t.Optional(t.Nullable(t.String())),
        limit: t.Optional(t.Nullable(t.String())),
        category_id: t.Optional(t.Nullable(t.String())),
        is_active: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Shops"], summary: "List products with pagination + filters" },
};
