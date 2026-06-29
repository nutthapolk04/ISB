import { Elysia } from "elysia";
import router from "@/routes";

/** Minimal app for integration tests — same route wiring as production. */
export function createTestApp() {
  return new Elysia().use(router);
}
