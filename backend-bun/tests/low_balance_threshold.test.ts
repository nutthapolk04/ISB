/**
 * Low-balance alerts — whose threshold actually decides.
 *
 * A guardian sets an alert balance on /parent/alerts/:id, which writes
 * `parent_child_links.low_balance_threshold`. The value was stored correctly and
 * read back onto the page, but checkAndSendLowBalanceAlerts() only ever consulted
 * the school-wide `low_balance_threshold` system setting — so the parent-facing
 * screen was a form that saved into a column nothing consulted.
 *
 * The agreed rule:
 *   - the admin toggle `low_balance_alert_enabled` is the master switch; a
 *     guardian's own setting can never turn alerting back on when it's off;
 *   - a guardian overrides the AMOUNT only;
 *   - no amount set → the school-wide default applies.
 *
 * Also pinned here: `last_low_balance_alert_at`. The column existed and the page
 * displayed it, but nothing wrote it, so it was permanently null.
 *
 * Conventions mirror the other DB-backed suites: localhost-only, run-unique
 * fixtures, FK-ordered cleanup in `finally`.
 */
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import {
    customers, customerTypes, emailAlertsLog, parentChildLinks, systemSettings, users, wallets,
} from "@/db/schema";
import {
    checkAndSendLowBalanceAlerts,
    resolveLowBalanceThreshold,
    sendPendingLowBalanceAlerts,
} from "@/services/low_balance_notification";

const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
const DB_TIMEOUT_MS = 45_000;
const TAG = `lbt-${Date.now().toString(36)}`;

/** system_settings is shared state, not a per-test fixture — bun runs every file
 *  in one process, so leaving these flipped would silently change alerting
 *  behaviour for other suites and for whoever owns this database next. */
const SETTING_KEYS = ["low_balance_alert_enabled", "low_balance_threshold"] as const;
const savedSettings = new Map<string, unknown>();

beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn(
            "[low_balance_threshold] Skipping DB-backed cases: DATABASE_URL is not localhost. " +
            "These tests write fixture rows and must not run against a shared database.",
        );
    }
    if (HAS_DB) dbOk = await pingDb();
    if (!dbOk) return;
    for (const key of SETTING_KEYS) {
        const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
        savedSettings.set(key, row ? row.value : undefined);
    }
});

afterAll(async () => {
    if (!dbOk) return;
    for (const [key, value] of savedSettings) {
        if (value === undefined) await db.delete(systemSettings).where(eq(systemSettings.key, key));
        else await setSetting(key, value);
    }
});

// ── Pure: which threshold wins ────────────────────────────────────────────

describe("resolveLowBalanceThreshold", () => {
    it("uses the school-wide default when no guardian has set one", () => {
        expect(resolveLowBalanceThreshold([null, null], 100)).toBe(100);
        expect(resolveLowBalanceThreshold([], 100)).toBe(100);
    });

    it("uses the guardian's amount when set", () => {
        expect(resolveLowBalanceThreshold(["250.00"], 100)).toBe(250);
        expect(resolveLowBalanceThreshold([250], 100)).toBe(250);
    });

    it("lets a guardian set a LOWER amount than the school default", () => {
        // Overriding downward has to work, not just upward — otherwise the
        // "override" is really a floor.
        expect(resolveLowBalanceThreshold(["50"], 100)).toBe(50);
    });

    it("takes the highest when guardians disagree — alert earlier, not never", () => {
        expect(resolveLowBalanceThreshold(["80", "300"], 100)).toBe(300);
        expect(resolveLowBalanceThreshold(["300", null], 100)).toBe(300);
    });

    it("ignores 0 and negative amounts rather than muting alerts entirely", () => {
        // A 0 threshold would mean "never alert"; treat it as unset.
        expect(resolveLowBalanceThreshold(["0"], 100)).toBe(100);
        expect(resolveLowBalanceThreshold(["-5"], 100)).toBe(100);
        expect(resolveLowBalanceThreshold(["0", "150"], 100)).toBe(150);
    });
});

// ── DB-backed ─────────────────────────────────────────────────────────────

const created = { customers: [] as number[], users: [] as number[], links: [] as number[], wallets: [] as number[] };

async function setSetting(key: string, value: unknown): Promise<void> {
    await db.insert(systemSettings).values({ key, value: value as never })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: value as never } });
}

async function seedFamily(suffix: string, guardians: Array<number | null>): Promise<{ childId: number }> {
    const [ct] = await db.select({ id: customerTypes.id }).from(customerTypes).limit(1);
    if (!ct) throw new Error("No customer_types row — seed the DB first");
    const [child] = await db.insert(customers).values({
        customerCode: `${TAG}-${suffix}`, name: `${TAG}-${suffix} child`, customerTypeId: ct.id,
        externalId: `${TAG}-${suffix}`, isActive: true, cardFrozen: false, customerKind: "student",
        familyCode: null,   // no family profile → falls back to guardian login emails
    }).returning({ id: customers.id });
    created.customers.push(child.id);

    const [w] = await db.insert(wallets).values({ customerId: child.id, balance: "0", isActive: true })
        .returning({ id: wallets.id });
    created.wallets.push(w.id);

    for (const [i, threshold] of guardians.entries()) {
        const [u] = await db.insert(users).values({
            username: `${TAG}-${suffix}-p${i}`, email: `${TAG}-${suffix}-p${i}@fixture.invalid`,
            fullName: `${TAG} guardian ${i}`, hashedPassword: "x", isActive: true, isSuperuser: false,
            role: "parent",
        }).returning({ id: users.id });
        created.users.push(u.id);

        const [link] = await db.insert(parentChildLinks).values({
            parentUserId: u.id, childCustomerId: child.id, relation: "guardian",
            lowBalanceAlertEnabled: false,      // the real-world default on every existing link
            lowBalanceThreshold: threshold === null ? null : threshold.toFixed(2),
        }).returning({ id: parentChildLinks.id });
        created.links.push(link.id);
    }
    return { childId: child.id };
}

async function queuedAlerts(childId: number) {
    return db.select().from(emailAlertsLog).where(eq(emailAlertsLog.childCustomerId, childId));
}

async function cleanup(): Promise<void> {
    if (created.customers.length) {
        await db.delete(emailAlertsLog).where(inArray(emailAlertsLog.childCustomerId, created.customers));
    }
    if (created.links.length) await db.delete(parentChildLinks).where(inArray(parentChildLinks.id, created.links));
    if (created.wallets.length) await db.delete(wallets).where(inArray(wallets.id, created.wallets));
    if (created.customers.length) await db.delete(customers).where(inArray(customers.id, created.customers));
    if (created.users.length) await db.delete(users).where(inArray(users.id, created.users));
    created.customers.length = 0; created.users.length = 0; created.links.length = 0; created.wallets.length = 0;
}

describe("checkAndSendLowBalanceAlerts — guardian threshold", () => {
    it.if(HAS_DB)(
        "queues on the guardian's amount, not the school default",
        async () => {
            if (!dbOk) return;
            try {
                await setSetting("low_balance_alert_enabled", true);
                await setSetting("low_balance_threshold", 100);
                // Guardian wants warning at 500. Balance 300 is above the school
                // default (100) so the old code queued nothing at all.
                const { childId } = await seedFamily("A", [500]);
                await checkAndSendLowBalanceAlerts(childId, 300);
                expect(await queuedAlerts(childId)).toHaveLength(1);
                expect(Number((await queuedAlerts(childId))[0].thresholdAmount)).toBeCloseTo(500, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "stays quiet above the guardian's amount",
        async () => {
            if (!dbOk) return;
            try {
                await setSetting("low_balance_alert_enabled", true);
                await setSetting("low_balance_threshold", 100);
                const { childId } = await seedFamily("B", [500]);
                await checkAndSendLowBalanceAlerts(childId, 501);
                expect(await queuedAlerts(childId)).toHaveLength(0);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "falls back to the school default when the guardian set nothing",
        async () => {
            if (!dbOk) return;
            // This is every existing link in production — threshold NULL — so the
            // fallback is what keeps behaviour unchanged for them.
            try {
                await setSetting("low_balance_alert_enabled", true);
                await setSetting("low_balance_threshold", 100);
                const { childId } = await seedFamily("C", [null]);
                await checkAndSendLowBalanceAlerts(childId, 150);
                expect(await queuedAlerts(childId)).toHaveLength(0);   // above default
                await checkAndSendLowBalanceAlerts(childId, 90);
                const rows = await queuedAlerts(childId);
                expect(rows).toHaveLength(1);
                expect(Number(rows[0].thresholdAmount)).toBeCloseTo(100, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "honours an amount LOWER than the school default",
        async () => {
            if (!dbOk) return;
            try {
                await setSetting("low_balance_alert_enabled", true);
                await setSetting("low_balance_threshold", 100);
                const { childId } = await seedFamily("D", [50]);
                await checkAndSendLowBalanceAlerts(childId, 80);   // under 100, over 50
                expect(await queuedAlerts(childId)).toHaveLength(0);
                await checkAndSendLowBalanceAlerts(childId, 40);
                expect(await queuedAlerts(childId)).toHaveLength(1);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "sends nothing when the admin switch is off, whatever the guardian set",
        async () => {
            if (!dbOk) return;
            // The one rule that must not be overridable.
            try {
                await setSetting("low_balance_alert_enabled", false);
                await setSetting("low_balance_threshold", 100);
                const { childId } = await seedFamily("E", [5000]);
                await checkAndSendLowBalanceAlerts(childId, 1);
                expect(await queuedAlerts(childId)).toHaveLength(0);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "does not require the per-link enabled flag — every existing link has it false",
        async () => {
            if (!dbOk) return;
            // Gating on parent_child_links.low_balance_alert_enabled would mute
            // alerts for the entire school: links are created with false and
            // nothing has ever set it true. Guardians override the amount only.
            try {
                await setSetting("low_balance_alert_enabled", true);
                await setSetting("low_balance_threshold", 100);
                const { childId } = await seedFamily("F", [null]);
                const links = await db.select().from(parentChildLinks)
                    .where(eq(parentChildLinks.childCustomerId, childId));
                expect(links.every((l) => l.lowBalanceAlertEnabled === false)).toBe(true);

                await checkAndSendLowBalanceAlerts(childId, 10);
                expect(await queuedAlerts(childId)).toHaveLength(1);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "takes the highest amount when two guardians differ",
        async () => {
            if (!dbOk) return;
            try {
                await setSetting("low_balance_alert_enabled", true);
                await setSetting("low_balance_threshold", 100);
                const { childId } = await seedFamily("G", [80, 400]);
                await checkAndSendLowBalanceAlerts(childId, 300);   // under 400, over 80
                const rows = await queuedAlerts(childId);
                expect(rows.length).toBeGreaterThan(0);
                expect(Number(rows[0].thresholdAmount)).toBeCloseTo(400, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );
});

describe("last_low_balance_alert_at", () => {
    it.if(HAS_DB)(
        "is written only when an alert actually goes out",
        async () => {
            if (!dbOk) return;
            // APP_ENV is not "prod" in tests, so sendEmail() refuses and the row
            // lands as 'skipped'. A skipped alert must not claim the family was
            // notified — the column stays null.
            const savedEnv = process.env.APP_ENV;
            try {
                delete process.env.APP_ENV;
                await setSetting("low_balance_alert_enabled", true);
                await setSetting("low_balance_threshold", 100);
                const { childId } = await seedFamily("H", [null]);

                await checkAndSendLowBalanceAlerts(childId, 10);
                await sendPendingLowBalanceAlerts();

                const rows = await queuedAlerts(childId);
                expect(rows[0].status).toBe("skipped");
                const links = await db.select().from(parentChildLinks)
                    .where(eq(parentChildLinks.childCustomerId, childId));
                expect(links.every((l) => l.lastLowBalanceAlertAt === null)).toBe(true);
            } finally {
                if (savedEnv === undefined) delete process.env.APP_ENV;
                else process.env.APP_ENV = savedEnv;
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );
});
