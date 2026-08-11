import { t } from "elysia";

const checkoutItemSchema = t.Object({
    product_variant_id: t.Number(),
    // Store allows negative quantity (refund-via-POS on a normal sale line);
    // Canteen requires >= 1. Enforced per-shop-module in
    // pos_checkout_service.ts::checkout(), not here — schema just bounds it.
    quantity: t.Number({ minimum: -1_000_000, maximum: 1_000_000 }),
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
        payer_q: t.Optional(t.Nullable(t.String())),
        payment_method: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        shop_ids: t.Optional(t.Nullable(t.String())),
        transaction_mode: t.Optional(t.Nullable(t.String())),
        requester_user_id: t.Optional(t.Nullable(t.String())),
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
        include_stats: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["POS"], summary: "List receipts" },
};

export const posGetReceipt = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["POS"], summary: "Get receipt by id" },
};

export const posListTransactions = {
    query: t.Object({
        status: t.Optional(t.Nullable(t.String())),
        payment_method: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        shop_ids: t.Optional(t.Nullable(t.String())),
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["POS"], summary: "List checkout transactions (all statuses, all payment methods)" },
};

export const posGetTransaction = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["POS"], summary: "Get checkout transaction by id, with cart items resolved" },
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
        // "card" (physical swipe/tap) carries a 3% surcharge; "qr" never does.
        edc_mode: t.Optional(t.Nullable(t.Union([t.Literal("qr"), t.Literal("card")]))),
        cash_received: t.Optional(t.Nullable(t.Number())),
        discount: t.Optional(t.Nullable(t.Number())),
        notes: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        /** One key per checkout attempt. Repeats return the original receipt
         *  instead of creating a second one. Optional — omitting it is the
         *  pre-existing behaviour (kiosk, BAY QR webhook). */
        idempotency_key: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
        /** ref_code returned by POST /pos/edc-intent — when present, checkout
         *  updates that pending Transactions-tab row instead of creating a
         *  new one. Absent for every other payment method (unaffected). */
        edc_pending_ref: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
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

/**
 * Marks the Transactions-tab row 'cancelled' only — does NOT touch the
 * underlying payment_intent, which must stay 'pending' so a late webhook can
 * still complete the sale (see cancelPosQrIntent's doc comment for why a
 * hard cancel here would be unsafe). Cashier-initiated "give up on this QR"
 * signal, purely for log visibility.
 */
export const posQrIntentAbandon = {
    params: t.Object({ refCode: t.String() }),
    detail: { tags: ["POS"], summary: "Mark POS QR transaction log row as cancelled (cashier gave up)" },
};

/**
 * Log a pending EDC checkout attempt the instant the cashier picks EDC as the
 * payment method — before the terminal has replied. Same shape as the QR
 * intent's cart, reused as-is.
 */
export const posStartEdcAttempt = {
    body: t.Object({
        // Client-derived from the attempt's idempotency key (same value the
        // EDC telemetry log uses as pos_ref) — ties this row to that one.
        ref_code: t.String({ minLength: 8, maxLength: 50 }),
        amount: t.Number({ exclusiveMinimum: 0 }),
        cart: checkoutCartSchema,
    }),
    detail: { tags: ["POS"], summary: "Log a pending EDC checkout attempt (Transactions tab)" },
};

export const posEdcIntentAbandon = {
    params: t.Object({ refCode: t.String() }),
    detail: { tags: ["POS"], summary: "Mark a pending EDC transaction log row as cancelled (cashier gave up)" },
};

/**
 * EDC bridge telemetry. Every field except `event` and `context` is optional
 * on purpose: this is best-effort forensics written from the browser, and a
 * partial row beats a 422 that throws away the only record of a terminal
 * charge. `fields` is t.Unknown() because the bag's shape is exactly what we
 * don't know yet — the service sanitises and clamps it.
 */
export const posRecordEdcEvent = {
    body: t.Object({
        event: t.Union([t.Literal("started"), t.Literal("result"), t.Literal("error")]),
        context: t.String({ maxLength: 30 }),
        shop_id: t.Optional(t.Nullable(t.String({ maxLength: 50 }))),
        idempotency_key: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
        pos_ref: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
        edc_mode: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
        amount: t.Optional(t.Nullable(t.Number())),
        response_code: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
        response_message: t.Optional(t.Nullable(t.String())),
        approval_code: t.Optional(t.Nullable(t.String({ maxLength: 32 }))),
        masked_card: t.Optional(t.Nullable(t.String({ maxLength: 30 }))),
        rrn: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
        fields: t.Optional(t.Unknown()),
        cart_snapshot: t.Optional(t.Unknown()),
        checkout_attempted: t.Optional(t.Nullable(t.Boolean())),
        client_error: t.Optional(t.Nullable(t.String())),
        client_at: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["POS"], summary: "Record an EDC bridge event (best-effort telemetry)" },
};

export const posListEdcEvents = {
    query: t.Object({
        date_from: t.Optional(t.String()),
        date_to: t.Optional(t.String()),
        shop_id: t.Optional(t.String()),
        unrecorded_only: t.Optional(t.String()),
        limit: t.Optional(t.String()),
    }),
    detail: { tags: ["POS"], summary: "List EDC bridge events (manager/admin)" },
};

/**
 * Client report that a checkout request never completed. `payload` is the exact
 * body that was attempted, so the cart can be reconstructed; `client_error` is
 * what the browser saw. Not a failure claim — the service resolves the
 * idempotency key against receipts before storing anything.
 */
export const posReportFailedCheckout = {
    body: t.Object({
        payload: t.Unknown(),
        client_error: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["POS"], summary: "Report a checkout that never completed" },
};

export const posListFailedCheckouts = {
    query: t.Object({
        shop_id: t.Optional(t.String()),
        date_from: t.Optional(t.String()),
        date_to: t.Optional(t.String()),
        limit: t.Optional(t.String()),
    }),
    detail: { tags: ["POS"], summary: "List unsuccessful checkouts (manager/admin)" },
};
