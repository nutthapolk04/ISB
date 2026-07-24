import { t } from "elysia";

const sortOrderQuery = {
    sort_order: t.Optional(t.Nullable(t.String())),
};

export const adminAdjustmentReport = {
    query: t.Object({
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        direction: t.Optional(t.Nullable(t.String())),
        type: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
        ...sortOrderQuery,
    }),
    detail: { tags: ["Reports"], summary: "Wallet adjustment report" },
};

export const adminTransferReport = {
    query: t.Object({
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
        ...sortOrderQuery,
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
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
        ...sortOrderQuery,
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
        /** Restricts to createdBy IN (users where role = this) when no
         * specific cashier_id is given — used by the Kiosk Report's
         * "All kiosks" transaction view (cashier_role=kiosk). */
        cashier_role: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
        ...sortOrderQuery,
    }),
    detail: { tags: ["Reports"], summary: "Transaction report — every wallet-affecting event (sale, adjustment, top-up, transfer)" },
};

export const adminInternalUsedReport = {
    query: t.Object({
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        department_id: t.Optional(t.Nullable(t.String())),
        requester_user_id: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        module: t.Optional(t.Nullable(t.String())),
        ...sortOrderQuery,
    }),
    detail: { tags: ["Reports"], summary: "Internal Used Report — staff requisitions charged against a department's budget" },
};

export const adminKioskLogReport = {
    query: t.Object({
        kiosk_user_id: t.Optional(t.Nullable(t.String())),
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        level: t.Optional(t.Nullable(t.String())),
        category: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
        ...sortOrderQuery,
    }),
    detail: { tags: ["Reports"], summary: "Kiosk device event-log report" },
};
