import { Elysia } from "elysia";
import router from "@/routes";
import { buildOnErrorHandler } from "@/app";

/**
 * Minimal app for integration tests — same route wiring AND error-response
 * shapes as production (via the shared onError handler), but without
 * cors/swagger/rate-limiting so tests aren't affected by those.
 */
export function createTestApp() {
  return new Elysia().onError(buildOnErrorHandler()).use(router);
}
