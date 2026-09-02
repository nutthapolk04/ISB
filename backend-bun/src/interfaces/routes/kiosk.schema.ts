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

export const kioskTechnicianPasswordChanged = {
    detail: { tags: ["Kiosk"], summary: "Notify assigned custodians that the technician console password was changed" },
};

export const kioskLockAlert = {
    body: t.Object({
        ref: t.String({ minLength: 1, maxLength: 128 }),
        method: t.String({ minLength: 1, maxLength: 16 }),
        payer_id: t.String({ minLength: 1, maxLength: 64 }),
        receiver_id: t.String({ minLength: 1, maxLength: 64 }),
        actual_amount: t.Number({ minimum: 0 }),
        target_amount: t.Optional(t.Number({ minimum: 0 })),
        locked_at: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
    }),
    detail: { tags: ["Kiosk"], summary: "Notify assigned custodians that the kiosk entered Out-of-Service (LOCK)" },
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
