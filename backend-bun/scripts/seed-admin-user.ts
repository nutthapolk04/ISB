/**
 * Seed production admin accounts (default: admin + admin2, both admin1234).
 *
 * Usage (from backend-bun/):
 *   bun scripts/seed-admin-user.ts
 *   bun scripts/seed-admin-user.ts --update-password
 *
 * Env overrides:
 *   ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL, ADMIN_FULL_NAME
 *   ADMIN2_USERNAME, ADMIN2_PASSWORD, ADMIN2_EMAIL, ADMIN2_FULL_NAME
 */
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { db, pgClient } from "../src/db/client";
import { encodePassword } from "../src/utils/AuthUtils";

const updatePassword = process.argv.includes("--update-password");

export interface AdminSeedSpec {
    username: string;
    password: string;
    email: string;
    fullName: string;
}

export function buildAdminSpec(): AdminSeedSpec {
    return {
        username: process.env.ADMIN_USERNAME ?? "admin",
        password: process.env.ADMIN_PASSWORD ?? "admin1234",
        email: process.env.ADMIN_EMAIL ?? "admin@isb-coop.local",
        fullName: process.env.ADMIN_FULL_NAME ?? "System Admin",
    };
}

export function buildAdmin2Spec(): AdminSeedSpec {
    return {
        username: process.env.ADMIN2_USERNAME ?? "admin2",
        password: process.env.ADMIN2_PASSWORD ?? "admin1234",
        email: process.env.ADMIN2_EMAIL ?? "admin2@isb-coop.local",
        fullName: process.env.ADMIN2_FULL_NAME ?? "System Admin 2",
    };
}

/** Idempotent upsert — returns the admin user id. */
export async function seedAdminUser(spec: AdminSeedSpec = buildAdminSpec()): Promise<number> {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is required");
    }

    if (spec.password.length < 6) {
        throw new Error(`Admin password for '${spec.username}' must be at least 6 characters`);
    }

    const existing = await db
        .select()
        .from(users)
        .where(eq(users.username, spec.username))
        .limit(1);

    if (existing[0]) {
        const user = existing[0];
        const patches: Partial<typeof users.$inferInsert> = {};

        if (user.role !== "admin") patches.role = "admin";
        if (!user.isSuperuser) patches.isSuperuser = true;
        if (!user.isActive) patches.isActive = true;
        if (user.status !== "active") patches.status = "active";
        if (user.email !== spec.email) patches.email = spec.email;
        if (updatePassword) {
            patches.hashedPassword = await encodePassword(spec.password);
        }

        if (Object.keys(patches).length > 0) {
            await db.update(users).set(patches).where(eq(users.id, user.id));
            console.log(`  ~ Updated '${spec.username}' (id=${user.id})`);
            if (updatePassword) console.log("    password hash updated");
        } else {
            console.log(`  = '${spec.username}' already exists (id=${user.id})`);
        }
        return user.id;
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
            role: "admin",
            isActive: true,
            isSuperuser: true,
            status: "active",
        })
        .returning({ id: users.id });

    const id = inserted[0]!.id;
    console.log(`  + Created '${spec.username}' (id=${id})`);
    return id;
}

async function main(): Promise<void> {
    console.log("Seeding admin users...");
    const id = await seedAdminUser();
    console.log(`  primary admin id=${id}`);
    const id2 = await seedAdminUser(buildAdmin2Spec());
    console.log(`  secondary admin id=${id2}`);
    console.log("Done.");
}

if (import.meta.main) {
    main()
        .catch((err) => {
            console.error(err instanceof Error ? err.message : err);
            process.exitCode = 1;
        })
        .finally(async () => {
            await pgClient.end({ timeout: 5 });
        });
}
