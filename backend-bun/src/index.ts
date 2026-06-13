import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { config, APP_VERSION } from "@/lib/config";
import { healthRoutes } from "@/routes/health";
import { shopRoutes } from "@/routes/shops";
import { productRoutes } from "@/routes/products";
import { customerRoutes } from "@/routes/customers";
import { reportRoutes } from "@/routes/reports";
import { jwtPlugin, requireAuth } from "@/middleware/auth";

const app = new Elysia()
  .use(
    cors({
      origin: config.corsOrigins.length === 1 && config.corsOrigins[0] === "*"
        ? true
        : config.corsOrigins,
      credentials: true,
    }),
  )
  .use(
    swagger({
      path: "/docs",
      documentation: {
        info: {
          title: "ISB Backend (Bun + Elysia)",
          version: APP_VERSION,
          description: "Schooney Payment System — new backend during migration",
        },
      },
    }),
  )
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 422;
      return { detail: error.message };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { detail: "Not found" };
    }
    console.error("Unhandled error:", error);
    set.status = set.status === 200 ? 500 : set.status;
    return { detail: error instanceof Error ? error.message : "Internal error" };
  })
  .use(healthRoutes)
  // Sample protected route — to be replaced by real /me when /users is migrated
  .use(jwtPlugin)
  .group("/api/v1", (api) =>
    api
      .use(requireAuth)
      .get("/me", ({ user }) => ({
        sub: user.sub,
        username: user.username,
        roles: user.roles,
        is_superuser: user.is_superuser,
      }))
      .use(shopRoutes)
      .use(productRoutes)
      .use(customerRoutes)
      .use(reportRoutes),
  )
  .listen(config.port);

console.log(
  `🚀 ISB backend-bun listening on http://localhost:${config.port} (env=${config.nodeEnv})`,
);
console.log(`   Docs: http://localhost:${config.port}/docs`);
