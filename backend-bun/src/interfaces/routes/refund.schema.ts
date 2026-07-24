import { t } from "elysia";

export const refundCandidates = {
    detail: { tags: ["Reports"], summary: "List graduation refund candidates" },
};

export const refundFamilySearch = {
    query: t.Object({
        q: t.String({ minLength: 2, maxLength: 100 }),
        limit: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Reports"], summary: "Search families for refund" },
};

export const refundFamilyRoster = {
    params: t.Object({ family_code: t.String({ minLength: 1, maxLength: 20 }) }),
    detail: { tags: ["Reports"], summary: "Get family roster for refund" },
};

export const refundCreate = {
    params: t.Object({ customer_id: t.String() }),
    body: t.Object({
        amount: t.Number({ exclusiveMinimum: 0 }),
        method: t.Union([t.Literal("CASH"), t.Literal("BANK_TRANSFER"), t.Literal("CHEQUE")]),
        notes: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
        // Client-generated key (e.g. crypto.randomUUID()) — lets a retried
        // request (lost connection, refund officer resubmitting) return the
        // same result instead of debiting the customer's balance twice.
        idempotency_key: t.Optional(t.String({ minLength: 8, maxLength: 64 })),
    }),
    detail: { tags: ["Reports"], summary: "Create graduation refund" },
};
