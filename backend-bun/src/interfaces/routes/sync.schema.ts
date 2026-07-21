import { t } from "elysia";

const syncChannelParam = t.Union([t.Literal("families"), t.Literal("staffs"), t.Literal("departments")]);

export const syncCapturesList = {
    params: t.Object({ channel: syncChannelParam }),
    detail: { tags: ["Admin"], summary: "List captured ISB sync rounds for a channel" },
};

export const syncCapturesPreview = {
    params: t.Object({ channel: syncChannelParam, roundId: t.String() }),
    detail: { tags: ["Admin"], summary: "Preview a captured ISB sync round" },
};

export const syncCapturesRun = {
    params: t.Object({ channel: syncChannelParam, roundId: t.String() }),
    detail: { tags: ["Admin"], summary: "Run Manual Sync from a captured ISB sync round" },
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
