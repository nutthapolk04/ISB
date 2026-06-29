import { t } from "elysia";

export const familyMe = {
    detail: { tags: ["Family"], summary: "List my children" },
};

export const familyCoparents = {
    detail: { tags: ["Family"], summary: "List co-parents" },
};

export const familyGetLowBalanceAlert = {
    params: t.Object({ child_id: t.String() }),
    detail: { tags: ["Family"], summary: "Get low-balance alert for child" },
};

export const familyUpdateLowBalanceAlert = {
    params: t.Object({ child_id: t.String() }),
    body: t.Object({
        enabled: t.Boolean(),
        threshold: t.Optional(t.Nullable(t.Number())),
    }),
    detail: { tags: ["Family"], summary: "Update low-balance alert for child" },
};

export const familyContext = {
    params: t.Object({ student_code: t.String() }),
    detail: { tags: ["Family"], summary: "Student family context (admin)" },
};

export const familyByUser = {
    params: t.Object({ user_id: t.String() }),
    detail: { tags: ["Family"], summary: "Family by user id" },
};

export const familyListLinks = {
    detail: { tags: ["Family"], summary: "List parent-child links (admin)" },
};

export const familyCreateLink = {
    body: t.Object({
        parent_user_id: t.Number(),
        child_customer_id: t.Number(),
        relation: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Family"], summary: "Create parent-child link (admin)" },
};

export const familyDeleteLink = {
    params: t.Object({ link_id: t.String() }),
    detail: { tags: ["Family"], summary: "Delete parent-child link (admin)" },
};

export const familyFreezeAll = {
    body: t.Object({
        parent_user_id: t.Number(),
        frozen: t.Boolean(),
    }),
    detail: { tags: ["Family"], summary: "Freeze or unfreeze all children" },
};

export const familyOrphans = {
    detail: { tags: ["Family"], summary: "List orphan students (admin)" },
};
