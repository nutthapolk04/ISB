import router from "@/routes";
import cors from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";
import connectDB from "@/utils/Database";
import { logger, logging } from "@/logger";
import { version } from '../package.json'


export async function initializeServices() {
    logger.info('🚀 Starting Service...')
    try {
        await connectDB()
        logger.info('✅ Database connection initialized')
        logger.info(`🔥 Service started successfully on port ${Bun.env.PORT || 9100} version ${version}`)
    } catch (error) {
        logger.error('❌ Failed to start Service:', error)
        throw error
    }
}


const app = new Elysia()
    .use(cors({ origin: Bun.env.CORS_ORIGIN || '*' }))
    .use(swagger({
        path: '/docs',
        documentation: {
            info: {
                title: 'ISB Bookstore API',
                version,
                description:
                    'International School Bangkok bookstore, canteen POS, wallet, and master-data sync API (Bun + Elysia).',
            },
            tags: [
                { name: 'Health', description: 'Service health and database connectivity' },
                { name: 'Auth', description: 'Login, refresh tokens, and SSO' },
                {
                    name: 'ISB Sync',
                    description: 'Vendor master-data push (staff, families, departments) — x-api-key',
                },
                { name: 'Admin', description: 'Settings, audit logs, and user administration' },
                { name: 'Customers', description: 'Students, cards, allergies, and spending limits' },
                { name: 'Shops', description: 'Shops, categories, products, stock, and bundles' },
                { name: 'POS', description: 'Checkout, receipts, returns, and QR payments' },
                { name: 'Wallets', description: 'Balances, top-ups, transfers, and adjustments' },
                { name: 'Family', description: 'Parent portal — children, co-parents, low-balance alerts' },
                { name: 'Reports', description: 'Sales, inventory, and admin reports' },
                { name: 'Payments', description: 'BAY/PYMT gateway callbacks and payment intents' },
            ],
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'JWT',
                    },
                    isbApiKey: {
                        type: 'apiKey',
                        in: 'header',
                        name: 'x-api-key',
                        description: 'ISB vendor sync API key (ISB_SYNC_API_KEY)',
                    },
                },
            },
        },
    }))
    .get("/health", () => ({
        ok: true,
        message: "API is running",
    }))
    .use(logging)
    .use(router)
    .onError(({ code }) => {
        return {
            status: code,
            message: 'An error occurred while processing your request.',
        }
    });


export default app;
export type App = typeof app;
