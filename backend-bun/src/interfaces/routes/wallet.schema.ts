import { t } from "elysia";

export const walletMe = {
    detail: { tags: ["Wallets"], summary: "Get current user's wallet" },
};

export const walletFamily = {
    detail: { tags: ["Wallets"], summary: "List family wallets" },
};

export const walletGetById = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["Wallets"], summary: "Get wallet by id" },
};

export const walletTransactions = {
    params: t.Object({ id: t.String() }),
    query: t.Object({
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Wallets"], summary: "List wallet transactions" },
};

export const walletAdjust = {
    params: t.Object({ id: t.String() }),
    body: t.Object({
        amount: t.Number(),
        reason: t.String({ minLength: 1, maxLength: 500 }),
        reference_ticket: t.Optional(t.Nullable(t.String({ maxLength: 50 }))),
    }),
    detail: { tags: ["Wallets"], summary: "Admin adjust wallet balance" },
};

export const walletTransfer = {
    body: t.Object({
        from_wallet_id: t.Number(),
        to_wallet_id: t.Number(),
        amount: t.Number({ exclusiveMinimum: 0 }),
        note: t.String({ minLength: 1, maxLength: 500 }),
    }),
    detail: { tags: ["Wallets"], summary: "Transfer between wallets (note required, no department destinations)" },
};
