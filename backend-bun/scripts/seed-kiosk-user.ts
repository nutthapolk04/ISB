/**
 * Seed kiosk service accounts (role=kiosk) used by Capacitor kiosk apps.
 * Each physical device gets its own account so server audit (created_by) and
 * local logs can distinguish machines.
 *
 * Usage (from backend-bun/):
 *   bun run db:seed-kiosk
 *   bun run db:seed-kiosk -- --update-password
 *
 * Per-device overrides (device 2):
 *   KIOSK_SERVICE_2_USERNAME=kiosk_service_2
 *   KIOSK_SERVICE_2_PASSWORD=secret
 *   KIOSK_SERVICE_2_FULL_NAME="Canteen Building A"
 */
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { db, pgClient } from "../src/db/client";
import { encodePassword } from "../src/utils/AuthUtils";

const ROLE = "kiosk";
const updatePassword = process.argv.includes("--update-password");

interface KioskSeedSpec {
    username: string;
    password: string;
    email: string;
    fullName: string;
}

function buildSpecs(): KioskSeedSpec[] {
    const p1 = process.env.KIOSK_SERVICE_PASSWORD ?? "kiosk1234";
    const p2 = process.env.KIOSK_SERVICE_2_PASSWORD ?? p1;

    return [
        {
            username: process.env.KIOSK_SERVICE_USERNAME ?? "kiosk_service",
            password: p1,
            email: process.env.KIOSK_SERVICE_EMAIL ?? "kiosk@isb-coop.local",
            fullName: process.env.KIOSK_SERVICE_FULL_NAME ?? "Kiosk 1",
        },
        {
            username: process.env.KIOSK_SERVICE_2_USERNAME ?? "kiosk_service_2",
            password: p2,
            email: process.env.KIOSK_SERVICE_2_EMAIL ?? "kiosk2@isb-coop.local",
            fullName: process.env.KIOSK_SERVICE_2_FULL_NAME ?? "Kiosk 2",
        },
    ];
}

async function upsertKioskUser(spec: KioskSeedSpec): Promise<void> {
    if (spec.password.length < 6) {
        throw new Error(`Password for '${spec.username}' must be at least 6 characters`);
    }

    const existing = await db
        .select()
        .from(users)
        .where(eq(users.username, spec.username))
        .limit(1);

    if (existing[0]) {
        const user = existing[0];
        const patches: Partial<typeof users.$inferInsert> = {};

        if (user.role !== ROLE) patches.role = ROLE;
        if (!user.isActive) patches.isActive = true;
        if (user.status !== "active") patches.status = "active";
        if (user.email !== spec.email) patches.email = spec.email;
        // Only set full_name on create path — technician can rename on device.
        // On re-seed without --update-password, leave existing location label.
        if (updatePassword) {
            patches.hashedPassword = await encodePassword(spec.password);
        }

        if (Object.keys(patches).length === 0) {
            console.log(`  = '${spec.username}' already exists (id=${user.id})`);
            return;
        }

        await db.update(users).set(patches).where(eq(users.id, user.id));
        console.log(`  ~ Updated '${spec.username}' (id=${user.id})`);
        if (updatePassword) {
            console.log(`    password hash updated`);
        }
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
            role: ROLE,
            isActive: true,
            isSuperuser: false,
            status: "active",
        })
        .returning({ id: users.id });

    const id = inserted[0]?.id;
    console.log(`  + Created '${spec.username}' (id=${id}, location="${spec.fullName}")`);
}

async function seedKioskUsers(): Promise<void> {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is required");
    }

    const specs = buildSpecs();
    console.log(`Seeding ${specs.length} kiosk service account(s)...`);
    for (const spec of specs) {
        await upsertKioskUser(spec);
    }
    console.log("Done. Set VITE_KIOSK_USERNAME / VITE_KIOSK_PASSWORD per device in kiosk/.env");
}

seedKioskUsers()
    .catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pgClient.end({ timeout: 5 });
    });
