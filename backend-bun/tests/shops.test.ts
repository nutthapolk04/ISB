import { describe, expect, it, beforeAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";

/**
 * Contract tests for GET /shops — verify response shape matches the
 * FastAPI ShopResponse schema exactly (keys, types, ISO datetime).
 *
 * Run against the same DB as production; requires DATABASE_URL.
 * Mints HS256 tokens locally using JWT_SECRET (must match FastAPI).
 */

const REQUIRED_DB_TEST = !!process.env.DATABASE_URL;
const TEST_SID = "test-sid-shops-contract";

beforeAll(async () => {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = "change-me-in-production-32chars!!";
  }
  // Auth now checks the token's `sid` claim against users.session_token
  // (see AuthUtils.verifySessionToken) — minted test tokens need a matching
  // session_token row for user id 1, not just a valid signature.
  if (REQUIRED_DB_TEST) {
    await db.update(users).set({ sessionToken: TEST_SID }).where(eq(users.id, 1));
  }
});

function mintToken(secret: string, payload: Record<string, unknown>): string {
  const header = { alg: "HS256", typ: "JWT" };
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${b64(header)}.${b64(payload)}`;
  const hmac = new Bun.CryptoHasher("sha256", secret);
  hmac.update(data);
  const sig = hmac
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${data}.${sig}`;
}

describe("GET /api/v1/shops contract", () => {
  it.if(REQUIRED_DB_TEST)("returns array of ShopResponse-shaped objects", async () => {
    const { createTestApp } = await import("./helpers");
    const app = createTestApp();

    const token = mintToken(process.env.JWT_SECRET!, {
      sub: "1",
      username: "test",
      email: "test@example.com",
      roles: ["admin"],
      is_superuser: true,
      type: "access",
      exp: Math.floor(Date.now() / 1000) + 3600,
      sid: TEST_SID,
    });

    const res = await app.handle(
      new Request("http://localhost/api/v1/shops/", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);

    const expectedKeys = [
      "id",
      "name",
      "shop_type",
      "description",
      "is_active",
      "allow_department_charge",
      "module",
      "uses_dual_pricing",
      "products_order_version",
      "created_at",
      "spending_group_id",
      "receipt_header",
      "receipt_footer",
      "void_shortcuts",
      "shop_number",
    ].sort();

    const shop = body[0]!;
    expect(Object.keys(shop).sort()).toEqual(expectedKeys);
    expect(typeof shop.id).toBe("string");
    expect(typeof shop.name).toBe("string");
    expect(["avg_cost", "fifo"]).toContain(shop.shop_type as string);
    expect(typeof shop.is_active).toBe("boolean");
    expect(["canteen", "store"]).toContain(shop.module as string);
    expect(typeof shop.products_order_version).toBe("number");

    // ISO 8601 datetime with timezone, microsecond-precision allowed
    expect(shop.created_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}:\d{2}$/,
    );
  });

  it.if(REQUIRED_DB_TEST)("filters by module=canteen", async () => {
    const { createTestApp } = await import("./helpers");
    const app = createTestApp();

    const token = mintToken(process.env.JWT_SECRET!, {
      sub: "1",
      username: "test",
      email: "test@example.com",
      roles: ["admin"],
      is_superuser: true,
      type: "access",
      exp: Math.floor(Date.now() / 1000) + 3600,
      sid: TEST_SID,
    });

    const res = await app.handle(
      new Request("http://localhost/api/v1/shops/?module=canteen", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ module: string }>;
    expect(body.every((s) => s.module === "canteen")).toBe(true);
  });

  it("rejects request without token", async () => {
    const { createTestApp } = await import("./helpers");
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/api/v1/shops/"),
    );
    expect(res.status).toBe(401);
  });
});
