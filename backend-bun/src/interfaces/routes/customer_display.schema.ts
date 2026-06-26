import { t } from "elysia";

export const customerDisplayListPublic = {
    detail: { tags: ["Admin"], summary: "List customer display images (public)" },
};

export const customerDisplayGetBinary = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["Admin"], summary: "Get customer display image binary (public)" },
};

export const customerDisplayUpload = {
    body: t.Object({ file: t.File() }),
    detail: { tags: ["Admin"], summary: "Upload customer display image" },
};

export const customerDisplayDelete = {
    params: t.Object({ id: t.String() }),
    detail: { tags: ["Admin"], summary: "Delete customer display image" },
};

export const customerDisplayReorder = {
    body: t.Object({ ordered_ids: t.Array(t.Number()) }),
    detail: { tags: ["Admin"], summary: "Reorder customer display images" },
};
