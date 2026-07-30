import { t } from "elysia";

export const kioskReleaseGetBinary = {
    params: t.Object({ filename: t.String() }),
    detail: { tags: ["Public"], summary: "Download kiosk APK release (public)" },
};
