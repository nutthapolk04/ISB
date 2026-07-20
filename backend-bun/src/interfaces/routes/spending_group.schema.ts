import { t } from "elysia";

export const spendingGroupUsageTodayByChild = {
    query: t.Object({ customer_id: t.String() }),
    detail: { tags: ["Admin"], summary: "Spending group usage today by child" },
};

export const spendingGroupUsageToday = {
    params: t.Object({ id: t.String() }),
    query: t.Object({
        payer_customer_id: t.Optional(t.Nullable(t.String())),
        payer_user_id: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Admin"], summary: "Spending group usage today" },
};

export const spendingGroupList = {
    detail: { tags: ["Admin"], summary: "List spending groups" },
};

export const spendingGroupGetById = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["Admin"], summary: "Get spending group" },
};

export const spendingGroupCreate = {
    body: t.Object({
        code: t.String({ minLength: 2, maxLength: 40 }),
        name_en: t.String({ minLength: 1, maxLength: 100 }),
        name_th: t.String({ minLength: 1, maxLength: 100 }),
        daily_limit: t.Number({ exclusiveMinimum: 0 }),
        grades: t.Optional(t.Array(t.String())),
        is_active: t.Optional(t.Nullable(t.Boolean())),
    }),
    detail: { tags: ["Admin"], summary: "Create spending group" },
};

export const spendingGroupUpdate = {
    params: t.Object({ id: t.String() }),
    body: t.Object({
        name_en: t.Optional(t.Nullable(t.String())),
        name_th: t.Optional(t.Nullable(t.String())),
        daily_limit: t.Optional(t.Nullable(t.Number({ exclusiveMinimum: 0 }))),
        grades: t.Optional(t.Nullable(t.Array(t.String()))),
        is_active: t.Optional(t.Nullable(t.Boolean())),
    }),
    detail: { tags: ["Admin"], summary: "Update spending group" },
};

export const spendingGroupDelete = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["Admin"], summary: "Delete spending group" },
};

export const spendingGroupListShops = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["Admin"], summary: "List assignable shops for spending group" },
};

export const spendingGroupSetShops = {
    params: t.Object({ id: t.String() }),
    body: t.Object({ shop_ids: t.Array(t.String()) }),
    detail: { tags: ["Admin"], summary: "Set linked shops for spending group" },
};
