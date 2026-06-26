import { t } from "elysia";

export const listDepartments = {
    query: t.Object({
        q: t.Optional(t.Nullable(t.String())),
        active_only: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Admin"], summary: "List departments with wallet summary" },
};
