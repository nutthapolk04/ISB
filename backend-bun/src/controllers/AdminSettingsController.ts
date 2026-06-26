import type { HandlerContext } from "@/controllers/types";
import { hasRole } from "@/middleware/AuthUtils";
import {
    KNOWN_FLAGS,
    SCHOOL_KEYS,
    getSchoolSettings,
    listKnown,
    setSchoolSettings,
    setValue,
} from "@/services/settings_service";
import { sendEmail } from "@/services/email_service";
import { adminOnly, forbidden } from "@/utils/ResponseUtil";

export const AdminSettingsController = {
    listKnown: async (ctx: any) => {
        const { user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        return await listKnown();
    },

    getSchoolSettings: async (ctx: any) => {
        const { user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        return await getSchoolSettings();
    },

    setSchoolSettings: async (ctx: any) => {
        const { user, body, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const userId = Number(user.sub);
        return await setSchoolSettings(body, userId);
    },

    setValue: async (ctx: any) => {
        const { params, body, user, set } = ctx;
        if (!hasRole(user.roles, "admin")) return adminOnly(set);
        const key = params.key;
        if (!(key in KNOWN_FLAGS) && !SCHOOL_KEYS.has(key)) {
            set.status = 404;
            return { detail: `Unknown setting key '${key}'` };
        }
        const userId = Number(user.sub);
        const newValue = await setValue(key, body.value, userId);
        return { key, value: newValue };
    },

    testEmail: async (ctx: any) => {
        const { body, user, set } = ctx;
        if (!hasRole(user.roles, "admin", "manager")) {
            return forbidden(set, "Admin/manager only");
        }
        const to = body.to ?? user.email;
        if (!to) {
            set.status = 400;
            return { detail: "No recipient email" };
        }
        try {
            await sendEmail(
                to,
                "ISB — Test Email",
                `<p>Test email sent successfully at ${new Date().toISOString()}</p>`,
            );
            return { sent: true, to };
        } catch (e) {
            set.status = 502;
            return { sent: false, error: e instanceof Error ? e.message : String(e) };
        }
    },
};
