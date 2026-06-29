import { t } from "elysia";

export const topupCreateIntent = {
    params: t.Object({ id: t.String() }),
    body: t.Object({
        amount: t.Number({ exclusiveMinimum: 0 }),
        notes: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
        payment_method: t.Optional(t.Nullable(t.String())),
        remark: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
        pay_type: t.Optional(t.Nullable(t.Union([t.Literal("N"), t.Literal("H")]))),
        lang: t.Optional(t.Nullable(t.Union([t.Literal("T"), t.Literal("E")]))),
    }),
    detail: { tags: ["Wallets"], summary: "Create wallet top-up intent" },
};

export const topupStatus = {
    params: t.Object({ refCode: t.String() }),
    detail: { tags: ["Wallets"], summary: "Get top-up intent status" },
};

export const topupParentConfirm = {
    params: t.Object({ refCode: t.String() }),
    detail: { tags: ["Wallets"], summary: "Parent self-confirm top-up" },
};

export const topupInquiry = {
    params: t.Object({ refCode: t.String() }),
    detail: { tags: ["Wallets"], summary: "Inquire top-up from gateway" },
};

export const topupCashier = {
    params: t.Object({ id: t.String() }),
    body: t.Object({
        amount: t.Number({ exclusiveMinimum: 0 }),
        notes: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
    }),
    detail: { tags: ["Wallets"], summary: "Cashier wallet top-up" },
};

export const topupAdjustDepartment = {
    params: t.Object({ department_id: t.String() }),
    body: t.Object({
        amount: t.Number(),
        reason: t.String({ minLength: 1, maxLength: 500 }),
        reference_ticket: t.Optional(t.Nullable(t.String({ maxLength: 50 }))),
    }),
    detail: { tags: ["Wallets"], summary: "Admin adjust department balance" },
};

export const topupDepartmentTransactions = {
    params: t.Object({ department_id: t.String() }),
    query: t.Object({
        limit: t.Optional(t.Nullable(t.String())),
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Wallets"], summary: "List department transactions" },
};

export const topupDeleteDepartment = {
    params: t.Object({ department_id: t.String() }),
    detail: { tags: ["Wallets"], summary: "Delete department" },
};
