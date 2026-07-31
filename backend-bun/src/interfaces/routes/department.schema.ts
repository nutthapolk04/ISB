import { t } from "elysia";

export const listDepartments = {
    query: t.Object({
        q: t.Optional(t.Nullable(t.String())),
        active_only: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ["Admin"], summary: "List departments with wallet summary" },
};

export const getDepartmentByCard = {
    params: t.Object({ uid: t.String() }),
    detail: { tags: ["Admin"], summary: "Lookup department by NFC card UID" },
};
