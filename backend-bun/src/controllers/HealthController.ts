import type { HandlerContext } from "@/controllers/types";
import { pingDb } from "@/db/client";
import { APP_VERSION } from "@/lib/config";

export const HealthController = {
    get: async () => {
        const dbOk = await pingDb();
        return {
            status: dbOk ? "ok" : "degraded",
            version: APP_VERSION,
            service: "isb-backend-bun",
            db: dbOk ? "up" : "down",
            timestamp: new Date().toISOString(),
        };
    },
};
