import { t } from "elysia";

export const cardholderList = {
    query: t.Object({
        kind: t.Optional(t.Nullable(t.String())),
        exclude_kind: t.Optional(t.Nullable(t.String())),
        has_wallet: t.Optional(t.Nullable(t.String())),
        q: t.Optional(t.Nullable(t.String())),
        school_type: t.Optional(t.Nullable(t.String())),
        grade: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Admin"], summary: "List cardholders" },
};

export const cardholderCreate = {
    body: t.Object({
        kind: t.Union([
            t.Literal("student"), t.Literal("parent"), t.Literal("staff"),
            t.Literal("department"), t.Literal("other"),
        ]),
        name: t.Optional(t.Nullable(t.String())),
        family_code: t.Optional(t.Nullable(t.String())),
        card_uid: t.Optional(t.Nullable(t.String())),
        customer_code: t.Optional(t.Nullable(t.String())),
        student_code: t.Optional(t.Nullable(t.String())),
        grade: t.Optional(t.Nullable(t.String())),
        school_type: t.Optional(t.Nullable(t.String())),
        initial_balance: t.Optional(t.Nullable(t.Number())),
        username: t.Optional(t.Nullable(t.String())),
        email: t.Optional(t.Nullable(t.String())),
        password: t.Optional(t.Nullable(t.String())),
        role: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        department_code: t.Optional(t.Nullable(t.String())),
        department_name: t.Optional(t.Nullable(t.String())),
        initial_credit: t.Optional(t.Nullable(t.Number())),
        phone: t.Optional(t.Nullable(t.String())),
        with_wallet: t.Optional(t.Nullable(t.Boolean())),
    }),
    detail: { tags: ["Admin"], summary: "Create cardholder" },
};
