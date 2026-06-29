import { t } from "elysia";

export const uomList = {
    query: t.Object({ active_only: t.Optional(t.Nullable(t.String())) }),
    detail: { tags: ["Shops"], summary: "List units of measure" },
};

export const uomGetById = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["Shops"], summary: "Get unit of measure" },
};

export const uomCreate = {
    body: t.Object({
        code: t.String({ minLength: 1, maxLength: 20 }),
        name: t.String({ minLength: 1, maxLength: 100 }),
        name_en: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
        base_uom_id: t.Optional(t.Nullable(t.Number())),
        conversion_factor: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
    }),
    detail: { tags: ["Shops"], summary: "Create unit of measure" },
};

export const uomUpdate = {
    params: t.Object({ id: t.String() }),
    body: t.Object({
        code: t.Optional(t.Nullable(t.String())),
        name: t.Optional(t.Nullable(t.String())),
        name_en: t.Optional(t.Nullable(t.String())),
        base_uom_id: t.Optional(t.Nullable(t.Number())),
        conversion_factor: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
        is_active: t.Optional(t.Nullable(t.Boolean())),
    }),
    detail: { tags: ["Shops"], summary: "Update unit of measure" },
};

export const uomDelete = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["Shops"], summary: "Delete unit of measure" },
};

export const uomSeedDefaults = {
    detail: { tags: ["Shops"], summary: "Seed default units of measure" },
};
