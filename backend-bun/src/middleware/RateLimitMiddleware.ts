import type { Context } from "elysia";
import { Elysia } from "elysia";
import ResponseStatus from "@/constants/ResponseStatus";
import { logger } from "@/logger";
import { errorResponse } from "@/utils/ResponseUtil";

interface WindowRecord {
	count: number;
	resetAt: number;
}

const store = new Map<string, WindowRecord>();

// Evict expired entries every minute
setInterval(() => {
	const now = Date.now();
	for (const [key, rec] of store.entries()) {
		if (now >= rec.resetAt) store.delete(key);
	}
}, 60_000);

type RateLimitContext = Context & { ip?: string };

function clientIp(ctx: RateLimitContext): string {
	return (
		ctx.ip ??
		ctx.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		"unknown"
	);
}

/**
 * Sliding-window rate limit handler.
 * @param max      max requests per window
 * @param windowMs window duration in ms (default 60 000)
 */
export function createRateLimit(max: number, windowMs = 60_000) {
	return async (ctx: RateLimitContext) => {
		const ip = clientIp(ctx);
		const path = new URL(ctx.request.url).pathname;
		const key = `${path}:${ip}`;
		const now = Date.now();
		const rec = store.get(key);

		if (!rec || now >= rec.resetAt) {
			store.set(key, { count: 1, resetAt: now + windowMs });
			return;
		}

		rec.count++;
		if (rec.count > max) {
			logger.warn(`[rate-limit] ${ip} exceeded ${max}/${windowMs}ms on ${path}`);
			return errorResponse(ctx, "Too many requests", ResponseStatus.TOO_MANY_REQUESTS);
		}
	};
}

/** Default API traffic: 300 requests/min per IP per path. */
export const globalRateLimit = createRateLimit(300);

/** Auth endpoints: 30 requests/min per IP per path. */
export const authRateLimit = createRateLimit(30);

export const rateLimitMiddleware = new Elysia({ name: "rate-limit" }).onBeforeHandle(
	{ as: "global" },
	globalRateLimit,
);
