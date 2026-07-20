import { t } from "elysia";

export const adminAdjustmentReport = {
    query: t.Object({
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        direction: t.Optional(t.Nullable(t.String())),
        type: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Reports"], summary: "Wallet adjustment report" },
};

export const adminTransferReport = {
    query: t.Object({
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Reports"], summary: "Wallet transfer report" },
};

export const adminTopupReport = {
    query: t.Object({
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        /** all | kiosk | online | cashier */
        channel: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Reports"], summary: "Wallet top-up report (kiosk / online / cashier)" },
};

export const adminTransactionReport = {
    query: t.Object({
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Reports"], summary: "POS transaction (spending) report" },
};
