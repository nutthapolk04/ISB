import { t } from "elysia";

export const adjustBalance = {
    body: t.Object({
        customerId: t.String(),
        transactionId: t.String(),
        amount: t.Number(),
        currency: t.Optional(t.Literal("THB")),
        type: t.Union([t.Literal("DEDUCT"), t.Literal("TOPUP")]),
        source: t.Union([
            t.Literal("POS"),
            t.Literal("ONLINE"),
            t.Literal("SYSTEM"),
            t.Literal("MANUAL"),
        ]),
        reasonCode: t.Optional(t.String()),
        description: t.Optional(t.String()),
        requestedBy: t.Optional(t.String()),
        requestedAt: t.Optional(t.String()),
    }),
    detail: {
        tags: ["Wallet"],
        summary: "Adjust (deduct/top-up) a cardholder's wallet balance (x-api-key)",
    },
};
