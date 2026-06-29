import { t } from "elysia";

export const bayCallback = {
    body: t.Object({
        transactionNo: t.Optional(t.Nullable(t.String())),
        reference1: t.Optional(t.Nullable(t.String())),
        reference2: t.Optional(t.Nullable(t.String())),
        orderRef: t.Optional(t.Nullable(t.String())),
        amount: t.Number(),
        status: t.Union([t.Literal("COMPLETED"), t.Literal("FAILED")]),
    }),
    detail: { tags: ["Payments"], summary: "BAY/PYMT payment webhook callback" },
};
