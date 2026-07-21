import { t } from "elysia";

export const profilePhotoGetBinary = {
    params: t.Object({ filename: t.String() }),
    detail: { tags: ["Public"], summary: "Get ISB profile photo binary (public)" },
};
