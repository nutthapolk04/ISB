/**
 * Seed the kiosk service account (role=kiosk) used by the Capacitor kiosk app.
 * Mirrors backend/seed.py defaults and kiosk/.env.example.
 *
 * Usage (from backend-bun/):
 *   bun run db:seed-kiosk
 *   KIOSK_SERVICE_PASSWORD=secret bun run db:seed-kiosk
 *   bun run db:seed-kiosk -- --update-password
 */
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { db, pgClient } from "../src/db/client";
import { encodePassword } from "../src/utils/AuthUtils";

const USERNAME = process.env.KIOSK_SERVICE_USERNAME ?? "kiosk_service";
const PASSWORD = process.env.KIOSK_SERVICE_PASSWORD ?? "kiosk1234";
const EMAIL = process.env.KIOSK_SERVICE_EMAIL ?? "kiosk@isb-coop.local";
const FULL_NAME = process.env.KIOSK_SERVICE_FULL_NAME ?? "Kiosk Service Account";
const ROLE = "kiosk";

const updatePassword = process.argv.includes("--update-password");

async function seedKioskUser(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  if (PASSWORD.length < 6) {
    throw new Error("KIOSK_SERVICE_PASSWORD must be at least 6 characters");
  }

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.username, USERNAME))
    .limit(1);

  if (existing[0]) {
    const user = existing[0];
    const patches: Partial<typeof users.$inferInsert> = {};

    if (user.role !== ROLE) patches.role = ROLE;
    if (!user.isActive) patches.isActive = true;
    if (user.status !== "active") patches.status = "active";
    if (user.email !== EMAIL) patches.email = EMAIL;
    if (user.fullName !== FULL_NAME) patches.fullName = FULL_NAME;

    if (updatePassword) {
      patches.hashedPassword = await encodePassword(PASSWORD);
    }

    if (Object.keys(patches).length === 0) {
      console.log(`Kiosk user '${USERNAME}' already exists (id=${user.id}, role=${user.role}).`);
      console.log("Pass --update-password to reset the password hash.");
      return;
    }

    await db.update(users).set(patches).where(eq(users.id, user.id));
    console.log(`Updated kiosk user '${USERNAME}' (id=${user.id}).`);
    if (updatePassword) {
      console.log("Password hash updated from KIOSK_SERVICE_PASSWORD.");
    }
    return;
  }

  const emailTaken = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, EMAIL))
    .limit(1);

  if (emailTaken[0]) {
    throw new Error(`Email '${EMAIL}' is already used by user id=${emailTaken[0].id}`);
  }

  const hashed = await encodePassword(PASSWORD);

  const inserted = await db
    .insert(users)
    .values({
      username: USERNAME,
      email: EMAIL,
      fullName: FULL_NAME,
      hashedPassword: hashed,
      role: ROLE,
      isActive: true,
      isSuperuser: false,
      status: "active",
    })
    .returning({ id: users.id });

  const id = inserted[0]?.id;
  console.log(`Created kiosk user '${USERNAME}' (id=${id}, role=${ROLE}).`);
  console.log(`Set VITE_KIOSK_USERNAME / VITE_KIOSK_PASSWORD in kiosk/.env to match.`);
}

seedKioskUser()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pgClient.end({ timeout: 5 });
  });
