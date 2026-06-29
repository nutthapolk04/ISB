import { t } from "elysia";

const returnItemSchema = t.Object({
    productCode: t.String(),
    productName: t.String(),
    quantity: t.Number({ minimum: 1 }),
    returnQuantity: t.Number({ minimum: 1 }),
    price: t.Number({ minimum: 0 }),
    bundleId: t.Optional(t.Nullable(t.Number())),
});

export const returnList = {
    query: t.Object({ filter: t.Optional(t.Nullable(t.String())) }),
    detail: { tags: ["POS"], summary: "List returns" },
};

export const returnByReceipt = {
    query: t.Object({ receiptId: t.String() }),
    detail: { tags: ["POS"], summary: "Get returns by receipt" },
};

export const returnGetById = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["POS"], summary: "Get return by id" },
};

export const returnHistory = {
    query: t.Object({ filter: t.Optional(t.Nullable(t.String())) }),
    detail: { tags: ["POS"], summary: "Return history" },
};

export const returnCreate = {
    body: t.Object({
        receiptId: t.String(),
        items: t.Array(returnItemSchema),
        reason: t.String({ minLength: 1 }),
    }),
    detail: { tags: ["POS"], summary: "Create return from receipt" },
};

export const returnCreateWithoutReceipt = {
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
    detail: { tags: ["POS"], summary: "Create return without receipt" },
};

export const returnUpdate = {
    params: t.Object({ id: t.String() }),
    body: t.Object({
        productName: t.Optional(t.Nullable(t.String())),
        quantity: t.Optional(t.Nullable(t.Number())),
        returnQuantity: t.Optional(t.Nullable(t.Number())),
        reason: t.Optional(t.Nullable(t.String())),
        status: t.Optional(t.Nullable(t.String())),
        priceType: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["POS"], summary: "Update return" },
};

export const returnDelete = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["POS"], summary: "Delete return" },
};

export const returnRefund = {
    params: t.Object({ id: t.String() }),
    body: t.Object({
        returnItems: t.Optional(t.Array(t.Object({ productCode: t.String(), returnQuantity: t.Number() }))),
        exchangeItems: t.Optional(t.Nullable(t.Array(t.Object({ productCode: t.String(), quantity: t.Number() })))),
        refundMethod: t.Optional(t.Nullable(t.String())),
        reason: t.String(),
        notes: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["POS"], summary: "Process return refund" },
};

export const returnExchange = {
    params: t.Object({ id: t.String() }),
    body: t.Object({
        returnItems: t.Optional(t.Array(t.Object({ productCode: t.String(), returnQuantity: t.Number() }))),
        exchangeItems: t.Array(t.Object({ productCode: t.String(), quantity: t.Number({ minimum: 1 }) }), { minItems: 1 }),
        difference: t.Optional(t.Nullable(t.Number())),
        reason: t.String(),
        notes: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["POS"], summary: "Process return exchange" },
};

export const returnSearchReceipts = {
    query: t.Object({
        receiptId: t.Optional(t.Nullable(t.String())),
        studentCode: t.Optional(t.Nullable(t.String())),
        dateFrom: t.Optional(t.Nullable(t.String())),
        dateTo: t.Optional(t.Nullable(t.String())),
        paymentMethod: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["POS"], summary: "Search receipts for returns" },
};

export const returnExchangeProducts = {
    query: t.Object({
        inStock: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["POS"], summary: "List products for exchange" },
};
