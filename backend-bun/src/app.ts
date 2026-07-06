import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";
import router from "@/routes";
import connectDB from "@/utils/Database";
import { ensureSchema } from "@/db/ensure_schema";
import { config, APP_VERSION } from "@/lib/config";
import { rateLimitMiddleware } from "@/middleware/RateLimitMiddleware";
import { timerMiddleware } from "@/middleware/TimerMiddleware";
import { logger, logError, logging } from "@/logger";
import { startLowBalanceScheduler } from "@/services/low_balance_scheduler";
import { version } from "../package.json";

export async function initializeServices() {
    logger.info("🚀 Starting ISB backend...");
    try {
        await ensureSchema();
        await connectDB();
        startLowBalanceScheduler();
        logger.info(
            `✅ Ready on port ${config.port} (env=${config.nodeEnv}, version=${APP_VERSION})`,
        );
    } catch (error) {
        logger.error("❌ Failed to start service:", error);
        throw error;
    }
}

const app = new Elysia()
    .use(
        cors({
            origin:
                config.corsOrigins.length === 1 && config.corsOrigins[0] === "*"
                    ? true
                    : config.corsOrigins,
            credentials: true,
            allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "X-PYMT-Signature"],
            methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        }),
    )
    .use(
        swagger({
            path: "/docs",
            documentation: {
                info: {
                    title: "ISB Bookstore API",
                    version,
                    description:
                        "International School Bangkok bookstore, canteen POS, wallet, and master-data sync API (Bun + Elysia).",
                },
                tags: [
                    { name: "Health", description: "Service health and database connectivity" },
                    { name: "Auth", description: "Login, refresh tokens, and SSO" },
                    {
                        name: "ISB Sync",
                        description: "Vendor master-data push (staff, families, departments) — x-api-key",
                    },
                    { name: "Admin", description: "Settings, audit logs, and user administration" },
                    { name: "Customers", description: "Students, cards, allergies, and spending limits" },
                    { name: "Shops", description: "Shops, categories, products, stock, and bundles" },
                    { name: "POS", description: "Checkout, receipts, returns, and QR payments" },
                    { name: "Wallets", description: "Balances, top-ups, transfers, and adjustments" },
                    { name: "Family", description: "Parent portal — children, co-parents, low-balance alerts" },
                    { name: "Reports", description: "Sales, inventory, and admin reports" },
                    { name: "Payments", description: "BAY/PYMT gateway callbacks and payment intents" },
                ],
                components: {
                    securitySchemes: {
                        bearerAuth: {
                            type: "http",
                            scheme: "bearer",
                            bearerFormat: "JWT",
                        },
                        isbApiKey: {
                            type: "apiKey",
                            in: "header",
                            name: "x-api-key",
                            description: "ISB vendor sync API key (ISB_SYNC_API_KEY)",
                        },
                    },
                },
            },
        }),
    )
    .use(timerMiddleware)
    .use(logging)
    .onError(({ code, error, set, requestID }) => {
        if (code === "VALIDATION") {
            set.status = 422;
            return { detail: error.message };
        }
        if (code === "NOT_FOUND") {
            set.status = 404;
            return { detail: "Not found" };
        }
        if (set.status === 401 || set.status === 403) {
            return { detail: error instanceof Error ? error.message : "Unauthorized" };
        }
        const rid = requestID ?? "unknown";
        logError(`[${rid}] Unhandled error (${String(code)})`, error);
        set.status = set.status === 200 ? 500 : set.status;
        return { detail: error instanceof Error ? error.message : "Internal error" };
    })
    .use(rateLimitMiddleware)
    .use(router);

export default app;
export type App = typeof app;
