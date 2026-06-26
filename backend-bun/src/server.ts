import { logger } from "@/logger";
import { config } from "@/lib/config";
import app, { initializeServices } from "@/app";

await initializeServices().catch((error) => {
    logger.error("Fatal error during initialization:", error);
    process.exit(1);
});

app.listen(config.port);

logger.info(`🚀 ISB backend-bun listening on http://localhost:${config.port}`);
logger.info(`   Docs: http://localhost:${config.port}/docs`);
logger.info(`   Registered routes: ${app.routes.length}`);
