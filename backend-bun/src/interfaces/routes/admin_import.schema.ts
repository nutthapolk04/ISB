import { t } from "elysia";

export const adminImportTemplate = {
    query: t.Object({ shop_id: t.Optional(t.Nullable(t.String())) }),
    detail: { tags: ["Admin"], summary: "Download bulk import template" },
};

export const adminImportProducts = {
    body: t.Object({ file: t.File() }),
    query: t.Object({ shop_id: t.Optional(t.Nullable(t.String())) }),
    detail: { tags: ["Admin"], summary: "Import products from xlsx" },
};

export const adminImportStockReceive = {
    body: t.Object({ file: t.File() }),
    detail: { tags: ["Admin"], summary: "Import stock receive from xlsx" },
};

export const adminImportStore = {
    body: t.Object({ file: t.File() }),
    query: t.Object({
        shop_id: t.Optional(t.Nullable(t.String())),
        dry_run: t.Optional(t.String()),
    }),
    detail: { tags: ["Admin"], summary: "Import store catalog from xlsx" },
};
