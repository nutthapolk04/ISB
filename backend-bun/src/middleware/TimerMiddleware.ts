import { Elysia } from "elysia";
import { logger } from "@/logger";

/** Per-request timing + X-Request-Id (runs globally, before route handlers). */
export const timerMiddleware = (app: Elysia) =>
	app
		.derive({ as: "global" }, ({ headers }) => ({
			timerStart: performance.now(),
			requestId: `${Date.now().toString(32).slice(-8)}${Math.random().toString(32).slice(2, 6)}`,
			device: headers["user-agent"] ?? "unknown",
			language: headers["accept-language"] ?? "en",
		}))
		.onBeforeHandle({ as: "global" }, (ctx) => {
			ctx.set.headers["X-Request-Id"] = ctx.requestId;
			logger.info(
				`[${ctx.requestId}] [\x1b[95mSTART\x1b[0m] ${ctx.request.method.toUpperCase()} ${ctx.path}`,
			);
		})
		.onAfterHandle({ as: "global" }, (ctx) => {
			logger.info(
				`[${ctx.requestId}] [\x1b[95mEND\x1b[0m] Time used: ${Math.round(performance.now() - ctx.timerStart)} ms`,
			);
		});

export default timerMiddleware;
