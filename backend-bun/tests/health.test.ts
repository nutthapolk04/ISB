import { describe, expect, it, beforeAll } from "bun:test";

// Sentinel to ensure required env is set for the tests to even load
beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
      "postgresql://test:test@localhost:5432/test_isb";
  }
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
  }
});

describe("health endpoint", () => {
  it("returns service metadata", async () => {
    const { healthRoutes } = await import("../src/routes/health");
    const res = await healthRoutes.handle(
      new Request("http://localhost/health"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      version: string;
      service: string;
      db: string;
      timestamp: string;
    };
    expect(body.service).toBe("isb-backend-bun");
    expect(["ok", "degraded"]).toContain(body.status);
    expect(body.version).toBeString();
    expect(body.db).toBeOneOf(["up", "down"]);
  });
});

describe("JWT middleware", () => {
  it("rejects request without Bearer token", async () => {
    process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    const { Elysia } = await import("elysia");
    const { requireAuth } = await import("../src/middleware/auth");
    const app = new Elysia().use(requireAuth).get("/secure", () => "ok");
    const res = await app.handle(new Request("http://localhost/secure"));
    expect(res.status).toBe(401);
  });
});
