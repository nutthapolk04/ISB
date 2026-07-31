import { t } from "elysia";

export const kioskReleaseGetManifest = {
    detail: { tags: ["Public"], summary: "Kiosk APK release manifest (version + per-device filenames)" },
    response: {
        200: t.Object({
            version: t.String(),
            version_code: t.Number(),
            published_at: t.String(),
            build_id: t.Optional(t.String()),
            artifacts: t.Array(
                t.Object({
                    filename: t.String(),
                    kiosk_username: t.Optional(t.String()),
                    download_url: t.Union([t.String(), t.Null()]),
                }),
            ),
        }),
    },
};

export const kioskReleaseGetBinary = {
    params: t.Object({ filename: t.String() }),
    detail: { tags: ["Public"], summary: "Download kiosk APK release (public)" },
};
