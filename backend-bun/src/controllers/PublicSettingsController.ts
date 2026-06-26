import type { HandlerContext } from "@/controllers/types";
import { getPublicSettings, getSchoolSettings } from "@/services/settings_service";

export const PublicSettingsController = {
    getPublicSettings: async (_ctx: any) => {
        return await getPublicSettings();
    },

    getSchoolSettings: async (_ctx: any) => {
        return await getSchoolSettings();
    },
};
