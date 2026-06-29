import { t } from "elysia";

export const listAuditLogs = {
    query: t.Object({
        entity_type: t.Optional(t.Nullable(t.String())),
        action: t.Optional(t.Nullable(t.String())),
        user_id: t.Optional(t.Nullable(t.String())),
        shop_id: t.Optional(t.Nullable(t.String())),
        date_from: t.Optional(t.Nullable(t.String())),
        date_to: t.Optional(t.Nullable(t.String())),
        page: t.Optional(t.Nullable(t.String())),
        page_size: t.Optional(t.Nullable(t.String())),
    }),
    detail: {
        tags: ["Admin"],
        summary: "Paginated audit logs (admin sees all, non-admin pinned to own shop)",
    },
};
