/**
 * Seed demo user accounts for testing frontend/backend
 * Creates users with different roles and shop assignments to test all flows:
 * - admin (no shop)
 * - manager_canteen (canteen module)
 * - cashier_canteen (canteen module)
 * - manager_store (store module)
 * - cashier_store (store module)
 * - parent (no shop)
 * - staff (no shop)
 *
 * Usage (from backend-bun/):
 *   bun run db:seed-demo-users
 *   DATABASE_URL=... bun scripts/seed-demo-users.ts
 */

import { eq } from "drizzle-orm";
import { users, shops } from "../drizzle/schema";
import { db, pgClient } from "../src/db/client";
import { encodePassword } from "../src/utils/AuthUtils";

interface DemoUserSpec {
  username: string;
  password: string;
  email: string;
  fullName: string;
  role: string;
  shopId?: string;
  shopModule?: string;
}

function buildDemoUsers(): DemoUserSpec[] {
  const basePassword = "demo1234";
  return [
    {
      username: "demo_admin",
      password: basePassword,
      email: "demo-admin@isb-coop.local",
      fullName: "Demo Admin",
      role: "admin",
      // admin has no shop
    },
    {
      username: "demo_manager_canteen",
      password: basePassword,
      email: "demo-manager-canteen@isb-coop.local",
      fullName: "Demo Manager Canteen",
      role: "manager",
      shopId: "N0001",
      shopModule: "canteen",
    },
    {
      username: "demo_cashier_canteen",
      password: basePassword,
      email: "demo-cashier-canteen@isb-coop.local",
      fullName: "Demo Cashier Canteen",
      role: "cashier",
      shopId: "N0001",
      shopModule: "canteen",
    },
    {
      username: "demo_manager_store",
      password: basePassword,
      email: "demo-manager-store@isb-coop.local",
      fullName: "Demo Manager Store",
      role: "manager",
      shopId: "S0001",
      shopModule: "store",
    },
    {
      username: "demo_cashier_store",
      password: basePassword,
      email: "demo-cashier-store@isb-coop.local",
      fullName: "Demo Cashier Store",
      role: "cashier",
      shopId: "S0001",
      shopModule: "store",
    },
    {
      username: "demo_parent",
      password: basePassword,
      email: "demo-parent@isb-coop.local",
      fullName: "Demo Parent",
      role: "parent",
      // parent has no shop
    },
    {
      username: "demo_staff",
      password: basePassword,
      email: "demo-staff@isb-coop.local",
      fullName: "Demo Staff",
      role: "staff",
      // staff has no shop
    },
  ];
}

async function verifyShopsExist(specs: DemoUserSpec[]): Promise<void> {
  const shopIds = new Set(specs.map((s) => s.shopId).filter(Boolean));
  if (shopIds.size === 0) return; // No shops required

  for (const shopId of shopIds) {
    console.log(`  Checking shop: ${shopId}`);
    const shop = await db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.id, shopId as string))
      .limit(1);

    if (!shop || shop.length === 0) {
      throw new Error(
        `Shop '${shopId}' does not exist. Available shops: check database first.`
      );
    }
    console.log(`  ✓ Shop '${shopId}' found`);
  }
}

async function upsertDemoUser(spec: DemoUserSpec): Promise<void> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.username, spec.username))
    .limit(1);

  if (existing[0]) {
    console.log(`  = '${spec.username}' already exists (id=${existing[0].id})`);
    return;
  }

  const emailTaken = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, spec.email))
    .limit(1);

  if (emailTaken[0]) {
    throw new Error(`Email '${spec.email}' is already used by user id=${emailTaken[0].id}`);
  }

  const hashed = await encodePassword(spec.password);
  const inserted = await db
    .insert(users)
    .values({
      username: spec.username,
      email: spec.email,
      fullName: spec.fullName,
      hashedPassword: hashed,
      role: spec.role,
      shopId: spec.shopId || null,
      shopModule: spec.shopModule || null,
      isActive: true,
      isSuperuser: spec.role === "admin",
      status: "active",
    })
    .returning({ id: users.id });

  const id = inserted[0]?.id;
  console.log(
    `  + Created '${spec.username}' (id=${id}, role=${spec.role}, shop=${spec.shopId || "—"})`
  );
}

async function seedDemoUsers(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const specs = buildDemoUsers();
  console.log(`Seeding ${specs.length} demo user(s) for testing...\n`);

  await verifyShopsExist(specs);

  for (const spec of specs) {
    await upsertDemoUser(spec);
  }

  console.log("\n✓ Done! Demo users ready.\n");
  console.log("Demo Credentials:");
  console.log("─".repeat(50));
  for (const spec of specs) {
    console.log(`  ${spec.username}`);
    console.log(`    Email:    ${spec.email}`);
    console.log(`    Password: ${spec.password}`);
    console.log(`    Role:     ${spec.role}${spec.shopId ? ` (shop=${spec.shopId})` : ""}`);
    console.log("");
  }
}

seedDemoUsers()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pgClient.end({ timeout: 5 });
  });
