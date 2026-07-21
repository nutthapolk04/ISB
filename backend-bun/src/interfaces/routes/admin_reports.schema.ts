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
        topped_by_user_id: t.Optional(t.Nullable(t.String())),
        topped_by_customer_id: t.Optional(t.Nullable(t.String())),
        recipient_user_id: t.Optional(t.Nullable(t.String())),
        recipient_customer_id: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Reports"], summary: "Wallet top-up report (kiosk / online / cashier)" },
};

export const adminTransactionReport = {
    query: t.Object({
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        search: t.Optional(t.Nullable(t.String())),
        cashier_id: t.Optional(t.Nullable(t.String())),
        /** ACTIVE | VOIDED */
        status: t.Optional(t.Nullable(t.String())),
        payment_method: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        /** all | sale | adjustment | topup | transfer */
        type: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Reports"], summary: "Transaction report — every wallet-affecting event (sale, adjustment, top-up, transfer)" },
};
