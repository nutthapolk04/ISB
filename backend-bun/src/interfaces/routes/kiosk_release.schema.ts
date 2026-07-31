import { t } from "elysia";

export const kioskReleaseGetManifest = {
    detail: { tags: ["Public"], summary: "Kiosk APK release manifest (version + per-device filenames)" },
};

export const kioskReleaseGetBinary = {
    params: t.Object({ filename: t.String() }),
    detail: { tags: ["Public"], summary: "Download kiosk APK release (public)" },
};
