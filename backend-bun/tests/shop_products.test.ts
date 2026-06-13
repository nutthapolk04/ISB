import { describe, expect, it, beforeAll } from "bun:test";

const HAS_DB = !!process.env.DATABASE_URL;

beforeAll(() => {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = "change-me-in-production-32chars!!";
  }
});

function mintToken(secret: string, payload: Record<string, unknown>): string {
  const header = { alg: "HS256", typ: "JWT" };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${b64(header)}.${b64(payload)}`;
  const hmac = new Bun.CryptoHasher("sha256", secret);
  hmac.update(data);
  return `${data}.${hmac.digest("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}

async function buildApp() {
  const { Elysia } = await import("elysia");
  const { shopRoutes } = await import("../src/routes/shops");
  return new Elysia({ prefix: "/api/v1" }).use(shopRoutes);
}

function token() {
  return mintToken(process.env.JWT_SECRET!, {
    sub: "1",
    username: "test",
    email: "t@x.com",
    roles: ["admin"],
    is_superuser: true,
    type: "access",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
}

// Phase 1 production DB lives in US-West; tests run from TH so each parallel
// fan-out adds ~200ms of latency. Bump timeout from the default 5s.
const DB_TIMEOUT_MS = 30_000;

describe("GET /shops/:shopId/products", () => {
  it.if(HAS_DB)("returns ShopProductResponse-shaped array for canteen", async () => {
    const app = await buildApp();
    const res = await app.handle(
      new Request("http://localhost/api/v1/shops/canteen/products", {
        headers: { Authorization: `Bearer ${token()}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    if (body.length === 0) return;
    const item = body[0]!;
    const expected = [
      "id",
      "shop_id",
      "product_code",
      "barcode",
      "name",
      "category",
      "external_price",
      "internal_price",
      "vat_percent",
      "avg_cost",
      "stock",
      "min_stock",
      "is_active",
      "photo_url",
      "color",
      "sort_order",
      "has_options",
      "uom_id",
      "uom_code",
      "uom_name",
      "short_name",
      "extra_barcodes",
    ].sort();
    expect(Object.keys(item).sort()).toEqual(expected);
    expect(item.shop_id).toBe("canteen");
    expect(typeof item.external_price).toBe("number");
    expect(typeof item.is_active).toBe("boolean");
    expect(Array.isArray(item.extra_barcodes)).toBe(true);
  }, DB_TIMEOUT_MS);

  it.if(HAS_DB)("returns 404 for unknown shop", async () => {
    const app = await buildApp();
    const res = await app.handle(
      new Request("http://localhost/api/v1/shops/__nonexistent__/products", {
        headers: { Authorization: `Bearer ${token()}` },
      }),
    );
    expect(res.status).toBe(404);
  }, DB_TIMEOUT_MS);
});

describe("GET /shops/:shopId/categories", () => {
  it.if(HAS_DB)("returns categories sorted by name", async () => {
    const app = await buildApp();
    const res = await app.handle(
      new Request("http://localhost/api/v1/shops/canteen/categories", {
        headers: { Authorization: `Bearer ${token()}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; name: string; shop_id: string }>;
    expect(Array.isArray(body)).toBe(true);
    body.forEach((c) => {
      expect(typeof c.id).toBe("string");
      expect(c.shop_id).toBe("canteen");
    });
    const names = body.map((c) => c.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  }, DB_TIMEOUT_MS);
});
