import { Elysia, t } from "elysia";
import { pingDb } from "@/db/client";
import { APP_VERSION } from "@/lib/config";

export const healthRoutes = new Elysia({ name: "health" }).get(
  "/health",
  async () => {
    const dbOk = await pingDb();
    return {
      status: dbOk ? "ok" : "degraded",
      version: APP_VERSION,
      service: "isb-backend-bun",
      db: dbOk ? "up" : "down",
      timestamp: new Date().toISOString(),
    };
  },
  {
    response: t.Object({
      status: t.String(),
      version: t.String(),
      service: t.String(),
      db: t.String(),
      timestamp: t.String(),
    }),
  },
);
