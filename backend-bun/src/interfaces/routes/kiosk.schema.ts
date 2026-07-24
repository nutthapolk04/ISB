import { t } from "elysia";

export const kioskMe = {
    detail: { tags: ["Kiosk"], summary: "Kiosk device profile (location label in full_name)" },
};

export const kioskUpdateLocation = {
    body: t.Object({
        full_name: t.String({ minLength: 1, maxLength: 255 }),
    }),
    detail: { tags: ["Kiosk"], summary: "Update kiosk installation location label (full_name)" },
};

export const kioskHeartbeat = {
    detail: { tags: ["Kiosk"], summary: "Kiosk liveness ping — call every ~1 min while the app is running" },
};

export const kioskUploadLogs = {
    body: t.Object({
        entries: t.Array(t.Object({
            ts: t.String(),
            level: t.String(),
            category: t.String(),
            message: t.String(),
            data: t.Optional(t.Unknown()),
        })),
    }),
    detail: { tags: ["Kiosk"], summary: "Upload a batch of on-device kiosk event-log entries" },
};
