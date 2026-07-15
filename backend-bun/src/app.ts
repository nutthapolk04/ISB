import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";
import router from "@/routes";
import connectDB from "@/utils/Database";
import { ensureSchema } from "@/db/ensure_schema";
import { config, APP_VERSION } from "@/lib/config";
import { rateLimitMiddleware } from "@/middleware/RateLimitMiddleware";
import { logError, logger, logging } from "@/logger";
import { startLowBalanceScheduler } from "@/services/low_balance_scheduler";
import { startTopupReconcileScheduler } from "@/services/topup_reconcile_scheduler";
import { mapValidationError, syncValidationFailed } from "@/lib/isb_sync_response";
import { version } from "../package.json";

const SYNC_PATHS = new Set(["/api/v1/sync/staffs", "/api/v1/sync/families", "/api/v1/sync/departments"]);

/**
 * Shared onError handler — exported so tests/helpers.ts can wire the same
 * error-response shapes into its minimal test app. Duplicating this inline
 * in two places let them drift silently (the ISB sync tests were asserting
 * against a test app that never saw this handler at all).
 */
export function buildOnErrorHandler() {
    return ({ code, error, set, requestId, path }: {
        code: string | number;
        error: unknown;
        set: { status?: number | string };
        requestId?: string;
        path: string;
    }) => {
        if (code === "VALIDATION") {
            // NOTE: plugin-level .onError() never fires for VALIDATION on nested
            // routes in Elysia 1.4.x — the root app's handler always wins. Any
            // route needing a custom validation-error shape must branch here.
            if (path === "/api/v1/wallet/adjust-balance") {
                set.status = 400;
                return {
                    status: "FAILED" as const,
                    code: "INVALID_REQUEST" as const,
                    message: "Request body does not match the expected schema.",
                    errors: mapValidationError(error as Error),
                };
            }
            if (SYNC_PATHS.has(path)) {
                return syncValidationFailed(set, mapValidationError(error as Error));
            }
            set.status = 422;
            return { detail: (error as Error).message };
        }
        if (code === "NOT_FOUND") {
            set.status = 404;
            return { detail: "Not found" };
        }
        if (set.status === 401 || set.status === 403) {
            return { detail: error instanceof Error ? error.message : "Unauthorized" };
        }
        const rid = requestId ?? "unknown";
        logError(`[${rid}] Unhandled error (${String(code)})`, error);
        set.status = set.status === 200 ? 500 : set.status;
        return { detail: error instanceof Error ? error.message : "Internal error" };
    };
}

export async function initializeServices() {
    logger.info("🚀 Starting ISB backend...");
    try {
        await ensureSchema();
        await connectDB();
        startLowBalanceScheduler();
        startTopupReconcileScheduler();
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
    .use(logging)
    .onError(buildOnErrorHandler())
    .use(rateLimitMiddleware)
    .use(router);

export default app;
export type App = typeof app;
