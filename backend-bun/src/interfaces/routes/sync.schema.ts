import { t } from "elysia";

export const syncRun = {
    body: t.Object({
        sync_type: t.Optional(t.Union([t.Literal("full"), t.Literal("delta")])),
        target_roles: t.Optional(t.Array(t.String())),
    }),
    detail: { tags: ["Admin"], summary: "Run PowerSchool sync (delta default)" },
};

export const syncPowerschool = {
    body: t.Object({
        sync_type: t.Optional(t.Union([t.Literal("full"), t.Literal("delta")])),
        target_roles: t.Optional(t.Array(t.String())),
    }),
    detail: { tags: ["Admin"], summary: "Run PowerSchool sync (full default)" },
};

export const syncLogs = {
    query: t.Object({
        limit: t.Optional(t.Nullable(t.String())),
        offset: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Admin"], summary: "List sync logs" },
};

export const syncStats = {
    query: t.Object({ days: t.Optional(t.Nullable(t.String())) }),
    detail: { tags: ["Admin"], summary: "Sync statistics" },
};

export const syncListStatuses = {
    query: t.Object({ limit: t.Optional(t.Nullable(t.String())) }),
    detail: { tags: ["Admin"], summary: "List sync statuses" },
};

export const syncGetLog = {
    params: t.Object({ syncLogId: t.String() }),
    detail: { tags: ["Admin"], summary: "Get sync log detail" },
};

export const syncAudit = {
    params: t.Object({ syncLogId: t.String() }),
    query: t.Object({ action: t.Optional(t.Nullable(t.String())) }),
    detail: { tags: ["Admin"], summary: "List sync audit entries" },
};
