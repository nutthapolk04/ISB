import { t } from "elysia";

export const getPublicSettings = {
    detail: { tags: ["Admin"], summary: "Public school display fields — no auth required" },
};

export const listKnownSettings = {
    detail: { tags: ["Admin"], summary: "List all known feature flags + values" },
};

export const getSchoolSettings = {
    detail: { tags: ["Admin"], summary: "Read school identity settings (admin)" },
};

export const setSchoolSettings = {
    body: t.Object({
        school_name: t.Optional(t.Nullable(t.String())),
        school_address: t.Optional(t.Nullable(t.String())),
        school_tax_id: t.Optional(t.Nullable(t.String())),
        school_phone: t.Optional(t.Nullable(t.String())),
        school_logo_url: t.Optional(t.Nullable(t.String())),
        school_cover_url: t.Optional(t.Nullable(t.String())),
        school_receipt_footer: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Admin"], summary: "Bulk update school identity settings (admin)" },
};

export const setSettingValue = {
    params: t.Object({ key: t.String() }),
    body: t.Object({ value: t.Any() }),
    detail: { tags: ["Admin"], summary: "Update a single setting by key (admin)" },
};

export const testEmail = {
    body: t.Object({ to: t.Optional(t.String()) }),
    detail: { tags: ["Admin"], summary: "Send a test email (admin/manager)" },
};
