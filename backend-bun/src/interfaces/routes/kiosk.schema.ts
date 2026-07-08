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
