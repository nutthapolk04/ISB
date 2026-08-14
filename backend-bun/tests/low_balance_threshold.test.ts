/**
 * Low-balance alerts — who decides whether one is sent, and at what balance.
 *
 * A guardian's settings live on `parent_child_links` (one row per guardian ×
 * child). Both were stored correctly and read back onto /parent/alerts/:id, but
 * checkAndSendLowBalanceAlerts() consulted only the school-wide system
 * settings — so the parent-facing screen was a form that saved into columns
 * nothing ever read. Saving also 404'd, because the page issued PUT against a
 * PATCH route.
 *
 * The agreed rules:
 *   - BOTH switches must be on. `low_balance_alert_enabled` (system) is the
 *     school's; `parent_child_links.low_balance_alert_enabled` is the family's,
 *     and it is off by default — nothing is sent until a guardian opts in.
 *   - the family's amount wins whenever it is set, higher or lower than the
 *     school's; a NULL amount follows the school default.
 *   - both settings are FAMILY-level per child: alerts go to shared family
 *     addresses that can't be attributed to one guardian, so every link for the
 *     child carries the same value. Siblings stay independent.
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
import { getLowBalanceAlert, updateLowBalanceAlert } from "@/services/family_service";

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

async function seedFamily(
    suffix: string,
    guardians: Array<number | null>,
    enabled = true,
): Promise<{ childId: number }> {
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
            lowBalanceAlertEnabled: enabled,
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
        "sends nothing when the family has not opted in, even with the school switch on",
        async () => {
            if (!dbOk) return;
            // The second half of "both switches must be on".
            try {
                await setSetting("low_balance_alert_enabled", true);
                await setSetting("low_balance_threshold", 100);
                const { childId } = await seedFamily("F", [null], false);
                await checkAndSendLowBalanceAlerts(childId, 1);
                expect(await queuedAlerts(childId)).toHaveLength(0);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "leaves a newly created guardian link opted out",
        async () => {
            if (!dbOk) return;
            // Default off is the whole premise: alerts only start once a guardian
            // asks for them. A link created by the admin link flow must not be
            // silently subscribed.
            try {
                const { childId } = await seedFamily("F2", [null], false);
                const [existing] = await db.select().from(parentChildLinks)
                    .where(eq(parentChildLinks.childCustomerId, childId)).limit(1);
                const [u] = await db.insert(users).values({
                    username: `${TAG}-F2-new`, email: `${TAG}-F2-new@fixture.invalid`,
                    fullName: `${TAG} new guardian`, hashedPassword: "x",
                    isActive: true, isSuperuser: false, role: "parent",
                }).returning({ id: users.id });
                created.users.push(u.id);
                const [fresh] = await db.insert(parentChildLinks).values({
                    parentUserId: u.id, childCustomerId: childId, relation: "guardian",
                }).returning();
                created.links.push(fresh.id);

                expect(fresh.lowBalanceAlertEnabled).toBe(false);
                expect(fresh.lowBalanceThreshold).toBeNull();
                expect(existing.lowBalanceAlertEnabled).toBe(false);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "keeps sending when a co-parent is added to an opted-in family",
        async () => {
            if (!dbOk) return;
            // A fresh link defaults to off. Requiring EVERY link to be on would
            // mean adding a co-parent silently mutes a family that had alerts
            // working — hence `some`, not `every`.
            try {
                await setSetting("low_balance_alert_enabled", true);
                await setSetting("low_balance_threshold", 100);
                const { childId } = await seedFamily("F3", [null], true);
                const [u] = await db.insert(users).values({
                    username: `${TAG}-F3-new`, email: `${TAG}-F3-new@fixture.invalid`,
                    fullName: `${TAG} co-parent`, hashedPassword: "x",
                    isActive: true, isSuperuser: false, role: "parent",
                }).returning({ id: users.id });
                created.users.push(u.id);
                const [fresh] = await db.insert(parentChildLinks).values({
                    parentUserId: u.id, childCustomerId: childId, relation: "guardian",
                }).returning({ id: parentChildLinks.id });
                created.links.push(fresh.id);

                await checkAndSendLowBalanceAlerts(childId, 10);
                expect((await queuedAlerts(childId)).length).toBeGreaterThan(0);
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

describe("updateLowBalanceAlert — family-level save", () => {
    it.if(HAS_DB)(
        "writes the setting to every guardian link for that child",
        async () => {
            if (!dbOk) return;
            // Delivery is to shared family addresses, so one value per child is
            // the only thing that can actually be honoured.
            try {
                const { childId } = await seedFamily("S1", [null, null], false);
                const links = await db.select().from(parentChildLinks)
                    .where(eq(parentChildLinks.childCustomerId, childId));
                expect(links).toHaveLength(2);

                await updateLowBalanceAlert({
                    parentUserId: links[0].parentUserId, childId, enabled: true, threshold: 250,
                });

                const after = await db.select().from(parentChildLinks)
                    .where(eq(parentChildLinks.childCustomerId, childId));
                expect(after.every((l) => l.lowBalanceAlertEnabled)).toBe(true);
                expect(after.every((l) => Number(l.lowBalanceThreshold) === 250)).toBe(true);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "leaves siblings alone",
        async () => {
            if (!dbOk) return;
            try {
                const a = await seedFamily("S2a", [null], false);
                const b = await seedFamily("S2b", [null], false);
                const [linkA] = await db.select().from(parentChildLinks)
                    .where(eq(parentChildLinks.childCustomerId, a.childId)).limit(1);

                await updateLowBalanceAlert({
                    parentUserId: linkA.parentUserId, childId: a.childId, enabled: true, threshold: 300,
                });

                const afterB = await db.select().from(parentChildLinks)
                    .where(eq(parentChildLinks.childCustomerId, b.childId));
                expect(afterB.every((l) => l.lowBalanceAlertEnabled === false)).toBe(true);
                expect(afterB.every((l) => l.lowBalanceThreshold === null)).toBe(true);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "clears the amount back to the school default — the 'Use default' button",
        async () => {
            if (!dbOk) return;
            // The old code skipped nulls entirely, so once a family set an amount
            // there was no route back to following the school.
            try {
                await setSetting("low_balance_threshold", 175);
                const { childId } = await seedFamily("S3", [400], true);
                const [link] = await db.select().from(parentChildLinks)
                    .where(eq(parentChildLinks.childCustomerId, childId)).limit(1);

                const out = await updateLowBalanceAlert({
                    parentUserId: link.parentUserId, childId, enabled: true, threshold: null,
                });

                expect(out.threshold).toBeNull();
                expect(out.default_threshold).toBe(175);
                const after = await db.select().from(parentChildLinks)
                    .where(eq(parentChildLinks.childCustomerId, childId));
                expect(after.every((l) => l.lowBalanceThreshold === null)).toBe(true);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "accepts enabled with no amount — that is the default-following state",
        async () => {
            if (!dbOk) return;
            // This used to be a 400 ("Threshold must be a positive number when
            // alerts are enabled"), which made "Use default" impossible.
            try {
                const { childId } = await seedFamily("S4", [null], false);
                const [link] = await db.select().from(parentChildLinks)
                    .where(eq(parentChildLinks.childCustomerId, childId)).limit(1);
                const out = await updateLowBalanceAlert({
                    parentUserId: link.parentUserId, childId, enabled: true, threshold: null,
                });
                expect(out.enabled).toBe(true);
                expect(out.threshold).toBeNull();
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "still rejects a zero or negative amount",
        async () => {
            if (!dbOk) return;
            try {
                const { childId } = await seedFamily("S5", [null], false);
                const [link] = await db.select().from(parentChildLinks)
                    .where(eq(parentChildLinks.childCustomerId, childId)).limit(1);
                await expect(updateLowBalanceAlert({
                    parentUserId: link.parentUserId, childId, enabled: true, threshold: 0,
                })).rejects.toThrow(/positive number/);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "refuses a child the caller isn't linked to",
        async () => {
            if (!dbOk) return;
            // Writing every link for the child makes the authorization check the
            // only thing standing between one guardian and another family's rows.
            try {
                const mine = await seedFamily("S6a", [null], false);
                const theirs = await seedFamily("S6b", [null], false);
                const [myLink] = await db.select().from(parentChildLinks)
                    .where(eq(parentChildLinks.childCustomerId, mine.childId)).limit(1);

                await expect(updateLowBalanceAlert({
                    parentUserId: myLink.parentUserId, childId: theirs.childId, enabled: true, threshold: 500,
                })).rejects.toThrow(/not linked/);

                const untouched = await db.select().from(parentChildLinks)
                    .where(eq(parentChildLinks.childCustomerId, theirs.childId));
                expect(untouched.every((l) => l.lowBalanceAlertEnabled === false)).toBe(true);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "reports the school default so the page can show a number",
        async () => {
            if (!dbOk) return;
            try {
                await setSetting("low_balance_threshold", 225);
                const { childId } = await seedFamily("S7", [null], false);
                const [link] = await db.select().from(parentChildLinks)
                    .where(eq(parentChildLinks.childCustomerId, childId)).limit(1);
                const out = await getLowBalanceAlert(link.parentUserId, childId);
                expect(out.threshold).toBeNull();
                expect(out.default_threshold).toBe(225);
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
