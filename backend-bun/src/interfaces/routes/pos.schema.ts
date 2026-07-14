import { t } from "elysia";

const checkoutItemSchema = t.Object({
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
});

const checkoutCartSchema = t.Object({
    transaction_mode: t.Optional(t.Nullable(t.String())),
    payer_kind: t.Optional(t.Nullable(t.String())),
    customer_id: t.Optional(t.Nullable(t.Number())),
    payer_user_id: t.Optional(t.Nullable(t.Number())),
    payer_department_id: t.Optional(t.Nullable(t.Number())),
    requester_user_id: t.Optional(t.Nullable(t.Number())),
    shop_id: t.Optional(t.Nullable(t.String())),
    discount: t.Optional(t.Nullable(t.Number())),
    notes: t.Optional(t.Nullable(t.String())),
    items: t.Array(checkoutItemSchema),
});

export const posListReceipts = {
    query: t.Object({
        q: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        shop_ids: t.Optional(t.Nullable(t.String())),
        transaction_mode: t.Optional(t.Nullable(t.String())),
        requester_user_id: t.Optional(t.Nullable(t.String())),
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["POS"], summary: "List receipts" },
};

export const posGetReceipt = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["POS"], summary: "Get receipt by id" },
};

export const posCheckout = {
    body: t.Object({
        transaction_mode: t.Optional(t.Nullable(t.String())),
        payment_method: t.String(),
        payer_kind: t.Optional(t.Nullable(t.String())),
        customer_id: t.Optional(t.Nullable(t.Number())),
        payer_user_id: t.Optional(t.Nullable(t.Number())),
        payer_department_id: t.Optional(t.Nullable(t.Number())),
        requester_user_id: t.Optional(t.Nullable(t.Number())),
        items: t.Array(checkoutItemSchema),
        edc_terminal_ref: t.Optional(t.Nullable(t.String())),
        edc_approval_code: t.Optional(t.Nullable(t.String())),
        edc_masked_card: t.Optional(t.Nullable(t.String())),
        cash_received: t.Optional(t.Nullable(t.Number())),
        discount: t.Optional(t.Nullable(t.Number())),
        notes: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["POS"], summary: "Checkout sale" },
};

export const posVoidReceipt = {
    params: t.Object({ id: t.String() }),
    // Reason is mandatory — frontend already enforces this, but the schema
    // must too so a direct API call can't void without one.
    body: t.Object({ reason: t.String({ minLength: 1 }) }),
    detail: { tags: ["POS"], summary: "Void receipt" },
};

export const posCreateQrIntent = {
    body: t.Object({
        amount: t.Number({ exclusiveMinimum: 0 }),
        cart: checkoutCartSchema,
    }),
    detail: { tags: ["POS"], summary: "Create POS QR payment intent" },
};

export const posQrIntentStatus = {
    params: t.Object({ refCode: t.String() }),
    detail: { tags: ["POS"], summary: "Get POS QR intent status" },
};

export const posQrIntentInquiry = {
    params: t.Object({ refCode: t.String() }),
    detail: { tags: ["POS"], summary: "Inquire POS QR intent from gateway" },
};

export const posQrIntentCancel = {
    params: t.Object({ refCode: t.String() }),
    detail: { tags: ["POS"], summary: "Cancel POS QR intent" },
};
