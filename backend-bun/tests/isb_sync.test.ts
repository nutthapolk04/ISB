import { describe, expect, it, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "../../docs/api/isb-payload-sample");
const TEST_API_KEY = process.env.ISB_SYNC_API_KEY ?? "test-api-key";
const REQUIRED_DB_TEST = !!process.env.DATABASE_URL;

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf-8"));
}

beforeAll(() => {
  process.env.ISB_SYNC_API_KEY = TEST_API_KEY;
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
  }
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
      "postgresql://test:test@localhost:5432/test_isb";
  }
});

async function getApp() {
  const { createTestApp } = await import("./helpers");
  return createTestApp();
}

function post(
  app: { handle: (req: Request) => Response | Promise<Response> },
  path: string,
  body: unknown,
  apiKey?: string,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey !== undefined) {
    headers["x-api-key"] = apiKey;
  }
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

describe("ISB sync API — auth", () => {
  it("returns 401 FAILED when x-api-key is missing", async () => {
    const app = await getApp();
    const res = await post(app, "/api/v1/sync/staffs", { staffs: [] });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("FAILED");
    expect(body.code).toBe("401");
  });

  it("returns 401 FAILED when x-api-key is wrong", async () => {
    const app = await getApp();
    const res = await post(app, "/api/v1/sync/staffs", { staffs: [] }, "wrong-key");
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("FAILED");
  });
});

describe("ISB sync API — validation", () => {
  it("returns 422 FAILED when staff body is missing customerId", async () => {
    const app = await getApp();
    const res = await post(
      app,
      "/api/v1/sync/staffs",
      {
        staffs: [
          {
            customerType: "Staff",
            staffType: "Classified Staff",
            department: "ED-TECH",
            familyCode: 1,
            firstName: "Test",
            lastName: "User",
            hasChildren: false,
            profileImage: "x.jpg",
            smartCard: { cardNumber: "" },
            login: { loginId: "a@b.c", email: "a@b.c" },
          },
        ],
      },
      TEST_API_KEY,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("FAILED");
    expect(body.code).toBe("422");
    expect(body.message).toBe(
      "Request body does not match the ISB->Vendor contract.",
    );
    expect(Array.isArray(body.errors)).toBe(true);
  });

  it("returns 422 FAILED when department body is missing departmentId", async () => {
    const app = await getApp();
    const res = await post(
      app,
      "/api/v1/sync/departments",
      {
        departments: [
          {
            customerType: "Department",
            departmentDescription: "TEST",
          },
        ],
      },
      TEST_API_KEY,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("FAILED");
    expect(body.code).toBe("422");
  });

  it("accepts department with optional smartCard (not 422)", async () => {
    const app = await getApp();
    const res = await post(
      app,
      "/api/v1/sync/departments",
      {
        departments: [
          {
            departmentId: "999001",
            customerType: "Department",
            departmentDescription: "TEST",
            smartCard: { cardNumber: "ABC" },
          },
        ],
      },
      TEST_API_KEY,
    );
    expect(res.status).not.toBe(422);
  });
});

describe("ISB sync API — success envelope", () => {
  it("empty staffs array returns 200 SUCCESS with exactly 3 keys", async () => {
    const app = await getApp();
    const res = await post(app, "/api/v1/sync/staffs", { staffs: [] }, TEST_API_KEY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      status: "SUCCESS",
      code: "200",
      message: "Accepted",
    });
    expect(Object.keys(body)).toHaveLength(3);
  });

  it("empty departments array returns 200 SUCCESS with exactly 3 keys", async () => {
    const app = await getApp();
    const res = await post(app, "/api/v1/sync/departments", { departments: [] }, TEST_API_KEY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      status: "SUCCESS",
      code: "200",
      message: "Accepted",
    });
    expect(Object.keys(body)).toHaveLength(3);
  });
});

describe("ISB sync API — DB integration", () => {
  it.if(REQUIRED_DB_TEST)("accepts staff.json sample batch", async () => {
    const app = await getApp();
    const payload = loadFixture("staff.json");
    const res = await post(app, "/api/v1/sync/staffs", payload, TEST_API_KEY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("SUCCESS");
  }, { timeout: 120_000 });

  it.if(REQUIRED_DB_TEST)("accepts parents.json (families) sample batch", async () => {
    const app = await getApp();
    const payload = loadFixture("parents.json");
    const res = await post(app, "/api/v1/sync/families", payload, TEST_API_KEY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("SUCCESS");
  }, { timeout: 120_000 });

  it.if(REQUIRED_DB_TEST)("accepts departments.json sample batch", async () => {
    const app = await getApp();
    const payload = loadFixture("departments.json");
    const res = await post(app, "/api/v1/sync/departments", payload, TEST_API_KEY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("SUCCESS");
  }, { timeout: 30_000 });

  it.if(REQUIRED_DB_TEST)("re-posting staff.json is idempotent (still SUCCESS)", async () => {
    const app = await getApp();
    const payload = loadFixture("staff.json");
    const res1 = await post(app, "/api/v1/sync/staffs", payload, TEST_API_KEY);
    expect(res1.status).toBe(200);
    const res2 = await post(app, "/api/v1/sync/staffs", payload, TEST_API_KEY);
    expect(res2.status).toBe(200);
    const body = (await res2.json()) as Record<string, unknown>;
    expect(body.status).toBe("SUCCESS");
  }, { timeout: 120_000 });
});
