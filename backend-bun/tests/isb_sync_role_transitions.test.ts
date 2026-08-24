/**
 * ISB role transitions — a person keeps ONE external_id and moves between
 * channels: staff -> other, other -> staff, parent -> other, other -> parent.
 * ISB sends them through exactly one batch per round, so "changed role" looks
 * like "stopped appearing here, started appearing there".
 *
 * What this file exists to stop happening again:
 *
 *  1. upsertStaff's UPDATE path never set `role`. An other -> staff transition
 *     therefore left the row at role="other" for good: auth_service refuses
 *     that role outright, so a real employee could never log in again — while
 *     customer_type read "Staff" and their login email was restored, hiding
 *     the cause from anyone looking at the record. On top of that
 *     other_sweep_service still owned the row, so it was deactivated every
 *     sweep and reactivated by every /sync/staffs round, forever.
 *  2. The obvious fix — always write the role — demotes an in-app admin who
 *     also appears in ISB's staff batch, because upsertStaff falls back to
 *     matching on email. Only ISB-owned roles may be overwritten.
 *  3. A row moved INTO "other" kept its real, SSO-resolvable email, so the
 *     "no login" guarantee rested on the role gate alone instead of all three
 *     layers it was designed to have.
 *  4. A parent moved into "other" kept parent_child_links, so a former
 *     guardian went on receiving a child's low-balance emails.
 *  5. A student's external_id arriving on /sync/others converted the student's
 *     login shell into an "other" card with a fresh empty wallet while the
 *     student's real customers row stayed active — the same physical card then
 *     charged the empty wallet and the real balance became unreachable.
 *
 * Conventions mirror the other DB-backed suites: localhost-only, run-unique
 * fixtures, FK-ordered cleanup in `finally`. Note what is NOT called here:
 * sweepStaleStaff and sweepStaleFamilies, which null family_code and delete
 * parent_child_links irreversibly — running those for real against a shared
 * database is not an acceptable way to assert anything.
 */
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import {
    customers, departments, emailAlertsLog, familyProfiles, parentChildLinks, systemSettings, userLoginEmails, users, wallets,
} from "@/db/schema";
import {
    processFamilyBatch, processOthersBatch, processStaffBatch,
    type IsbFamily, type IsbOther, type IsbStaff,
} from "@/services/isb_sync_service";
import { sweepStaleOthers } from "@/services/other_sweep_service";
import { login, mockSso } from "@/services/auth_service";
import { getUserPayerByCard, resolveScan } from "@/services/user_service";
import { checkAndSendLowBalanceAlerts, sendSingleLowBalanceAlert } from "@/services/low_balance_notification";
import { getRaw } from "@/services/settings_service";

const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
const DB_TIMEOUT_MS = 45_000;
const TAG = `rt-${Date.now().toString(36)}`;

/** Salted per run so concurrent runs can't collide on external_id (unique). */
const BASE = 9_500_000 + (Date.now() % 90_000);
const ext = (n: number) => BASE + n;
const CARD = (n: number) => `${TAG}-card-${n}`;

// system_settings is shared state — see low_balance_threshold.test.ts.
const SETTING_KEYS = ["low_balance_alert_enabled", "low_balance_threshold"] as const;
const savedSettings = new Map<string, unknown>();

function staffOf(n: number, over: Partial<IsbStaff> = {}): IsbStaff {
    return {
        customerId: ext(n), customerType: "Staff", staffType: "Teacher", department: "Science",
        familyCode: 500000 + n, firstName: `${TAG}S${n}`, lastName: "Person",
        hasChildren: false, profileImage: "", smartCard: { cardNumber: CARD(n) },
        login: [`${TAG}.s${n}@isb.ac.th`],
        ...over,
    };
}
function otherOf(n: number, over: Partial<IsbOther> = {}): IsbOther {
    return {
        customerId: ext(n), customerType: "Other", familyCode: 910000 + n,
        firstName: `${TAG}S${n}`, lastName: "Person", smartCard: { cardNumber: CARD(n) }, login: [],
        ...over,
    };
}
function familyOf(n: number, opts: { withParent: boolean }): IsbFamily {
    return {
        familyCode: 500000 + n,
        // Empty on purpose: it forces the low-balance recipient fallback that
        // reads each linked guardian's own users.email — the leaky branch.
        notificationEmails: [],
        mainParent: {
            customerId: ext(opts.withParent ? n : n + 500), customerType: "Parent",
            firstName: `${TAG}P${opts.withParent ? n : n + 500}`, lastName: "Guardian",
            profileImage: "", login: [`${TAG}.p${opts.withParent ? n : n + 500}@parents.isb.ac.th`],
            smartCard: { cardNumber: CARD(opts.withParent ? n : n + 500) },
        },
        secondaryParent: null,
        students: [{
            customerId: ext(n + 900), customerType: "Student",
            firstName: `${TAG}K${n}`, lastName: "Guardian", grade: "5", schoolType: "ES",
            profileImage: "", smartCard: { cardNumber: CARD(n + 900) },
        }],
    } as IsbFamily;
}

/** Same helper as low_balance_threshold.test.ts — settings_service exposes
 *  setValue() with validation, which these two flags don't need here. */
async function setSetting(key: string, value: unknown): Promise<void> {
    await db.insert(systemSettings).values({ key, value: value as never })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: value as never } });
}

async function userByExt(n: number) {
    const [u] = await db.select().from(users).where(eq(users.externalId, String(ext(n)))).limit(1);
    return u;
}
async function loginEmailsOf(userId: number) {
    return (await db.select().from(userLoginEmails).where(eq(userLoginEmails.userId, userId))).map((r) => r.email);
}

async function cleanup() {
    // full_name carries TAG on every fixture; username does not (upsertOther
    // derives it from external_id) — see isb_sync_others.test.ts.
    const uRows = await db.select({ id: users.id }).from(users).where(like(users.fullName, `%${TAG}%`));
    const cRows = await db.select({ id: customers.id }).from(customers).where(like(customers.name, `%${TAG}%`));
    const uIds = uRows.map((r) => r.id);
    const cIds = cRows.map((r) => r.id);
    if (cIds.length > 0) {
        await db.delete(emailAlertsLog).where(inArray(emailAlertsLog.childCustomerId, cIds));
        await db.delete(parentChildLinks).where(inArray(parentChildLinks.childCustomerId, cIds));
        await db.delete(wallets).where(inArray(wallets.customerId, cIds));
    }
    if (uIds.length > 0) {
        await db.delete(parentChildLinks).where(inArray(parentChildLinks.parentUserId, uIds));
        await db.delete(userLoginEmails).where(inArray(userLoginEmails.userId, uIds));
        await db.delete(wallets).where(inArray(wallets.userId, uIds));
    }
    if (cIds.length > 0) await db.delete(customers).where(inArray(customers.id, cIds));
    if (uIds.length > 0) await db.delete(users).where(inArray(users.id, uIds));
    await db.delete(familyProfiles).where(like(familyProfiles.familyCode, "5000%"));
}

beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn(
            "[isb_sync_role_transitions] Skipping DB-backed cases: DATABASE_URL is not localhost. " +
            "These tests write fixture rows and must not run against a shared database.",
        );
    }
    if (HAS_DB) dbOk = await pingDb();
    if (!dbOk) return;
    for (const key of SETTING_KEYS) savedSettings.set(key, await getRaw(key));
    await cleanup();
});

afterAll(async () => {
    if (!dbOk) return;
    await cleanup();
    for (const [key, value] of savedSettings) {
        if (value === undefined || value === null) await db.delete(systemSettings).where(eq(systemSettings.key, key));
        else await setSetting(key, value);
    }
});

// ── staff -> other ────────────────────────────────────────────────────────

describe("staff -> other", () => {
    it.if(HAS_DB)("flips the role, replaces the identity, and clears employment metadata", async () => {
        if (!dbOk) return;
        await processStaffBatch([staffOf(1)]);
        const before = await userByExt(1);
        expect(before!.role).toBe("staff");
        expect(before!.email).toBe(`${TAG}.s1@isb.ac.th`);
        // In-app columns ISB's payload cannot restore — set them so the test
        // can prove they are deliberately preserved, not overlooked.
        await db.update(users).set({ shopId: "S0001", shopModule: "store", sessionToken: "stale-session" })
            .where(eq(users.id, before!.id));

        await processOthersBatch([otherOf(1)]);
        const after = await userByExt(1);

        expect(after!.id).toBe(before!.id);              // same row, so same wallet
        expect(after!.role).toBe("other");
        expect(after!.customerType).toBe("Other");
        // The real, SSO-resolvable identity is gone.
        expect(after!.email).toBe(`other-${ext(1)}@others.isb.ac.th`);
        expect(after!.username).toBe(`other-${ext(1)}`);
        expect(await loginEmailsOf(after!.id)).toEqual([]);
        // Employment metadata ISB's own payload restores → cleared.
        expect(after!.staffType).toBeNull();
        expect(after!.psDepartment).toBeNull();
        // In-app grants sync cannot restore → preserved, not destroyed.
        expect(after!.shopId).toBe("S0001");
        expect(after!.shopModule).toBe("store");
        // Any outstanding session is invalidated by the role change.
        expect(after!.sessionToken).toBeNull();
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("leaves the wallet and its balance untouched", async () => {
        if (!dbOk) return;
        await processStaffBatch([staffOf(2)]);
        const u = await userByExt(2);
        const [w] = await db.select().from(wallets).where(eq(wallets.userId, u!.id)).limit(1);
        await db.update(wallets).set({ balance: "412.50" }).where(eq(wallets.id, w!.id));

        await processOthersBatch([otherOf(2)]);
        const payer = await getUserPayerByCard(CARD(2));
        expect(payer.wallet_id).toBe(w!.id);
        expect(payer.wallet_balance).toBeCloseTo(412.5, 2);
        expect(payer.role).toBe("other");
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("stops surfacing a department at the POS", async () => {
        if (!dbOk) return;
        await processStaffBatch([staffOf(3)]);
        const u = await userByExt(3);
        const [anyDept] = await db.select().from(departments).limit(1);
        // Asserting nothing would let this case rot into a silent pass, so
        // fail loudly instead if the fixture this needs isn't present.
        expect(anyDept, "this database has no departments to attach").toBeTruthy();
        await db.update(users).set({ departmentId: anyDept!.id }).where(eq(users.id, u!.id));
        const asStaff = await getUserPayerByCard(CARD(3));
        expect(asStaff.department_code).not.toBeNull();

        await processOthersBatch([otherOf(3)]);
        const asOther = await getUserPayerByCard(CARD(3));
        // department_id is left on the row (sync can't restore it) but withheld
        // at the read point, which is what the POS badge keys off.
        expect(asOther.department_id).toBeNull();
        expect(asOther.department_code).toBeNull();
        expect(asOther.department_name).toBeNull();
        expect((await userByExt(3))!.departmentId).toBe(anyDept!.id);
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("cannot log in afterwards, by password or by its former SSO address", async () => {
        if (!dbOk) return;
        await processStaffBatch([staffOf(4)]);
        await processOthersBatch([otherOf(4)]);
        const u = await userByExt(4);
        await expect(login(u!.username, "anything")).rejects.toThrow(/Invalid username or password/);
        // The address they used to sign in with must no longer resolve at all.
        await expect(mockSso(`${TAG}.s4@isb.ac.th`)).rejects.toThrow(/not registered/);
        await expect(mockSso(u!.email)).rejects.toThrow(/not registered/);
    }, DB_TIMEOUT_MS);
});

// ── other -> staff (the bug that stranded real employees) ─────────────────

describe("other -> staff", () => {
    it.if(HAS_DB)("restores role, real login, and the ability to sign in", async () => {
        if (!dbOk) return;
        await processOthersBatch([otherOf(10)]);
        expect((await userByExt(10))!.role).toBe("other");

        await processStaffBatch([staffOf(10)]);
        const u = await userByExt(10);
        expect(u!.role).toBe("staff");                    // regression guard for BUG 1
        expect(u!.customerType).toBe("Staff");
        expect(u!.email).toBe(`${TAG}.s10@isb.ac.th`);
        expect(u!.username).toBe(`${TAG}.s10`);
        expect(await loginEmailsOf(u!.id)).toContain(`${TAG}.s10@isb.ac.th`);
        expect(u!.staffType).toBe("Teacher");
        // The whole point: they can actually get in again.
        const tokens = await mockSso(`${TAG}.s10@isb.ac.th`);
        expect(tokens.access_token).toBeTruthy();
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("hands the row back to the staff sweep, ending the flip-flop", async () => {
        if (!dbOk) return;
        // While role stayed "other", other_sweep_service kept deactivating
        // this person and /sync/staffs kept reactivating them, indefinitely.
        await processOthersBatch([otherOf(11)]);
        await processStaffBatch([staffOf(11)]);
        const u = await userByExt(11);

        // Park every real "other" row stale so the sweep's gate is decided by
        // the fixture below, not by whatever else lives in this database.
        const parked = await db.select({ id: users.id, lastSyncedAt: users.lastSyncedAt, isActive: users.isActive })
            .from(users).where(eq(users.role, "other"));
        try {
            if (parked.length > 0) {
                await db.update(users).set({ lastSyncedAt: new Date(Date.now() - 48 * 3600_000).toISOString() })
                    .where(inArray(users.id, parked.map((r) => r.id)));
            }
            // A fresh "other" card holds the gate open so the sweep really runs.
            await processOthersBatch([otherOf(12)]);
            // ...and age our ex-other so it WOULD be swept if it still counted.
            await db.update(users).set({ lastSyncedAt: new Date(Date.now() - 48 * 3600_000).toISOString() })
                .where(eq(users.id, u!.id));

            const res = await sweepStaleOthers(3);
            expect(res.skippedNoRecentActivity).toBeFalsy();
            expect(res.externalIdsSwept).not.toContain(String(ext(11)));
            expect((await userByExt(11))!.isActive).toBe(true);
        } finally {
            for (const r of parked) {
                await db.update(users)
                    .set({ lastSyncedAt: r.lastSyncedAt, isActive: r.isActive, status: r.isActive ? "active" : "inactive" })
                    .where(eq(users.id, r.id));
            }
        }
    }, DB_TIMEOUT_MS);
});

// ── in-app roles must survive a sync round ───────────────────────────────

describe("nextSyncedRole", () => {
    it.if(HAS_DB)("does not demote an in-app admin who also appears in ISB's staff batch", async () => {
        if (!dbOk) return;
        // upsertStaff falls back to matching on email, so this row IS the one
        // the staff batch below lands on.
        const [admin] = await db.insert(users).values({
            username: `${TAG}.s20`, email: `${TAG}.s20@isb.ac.th`,
            fullName: `${TAG}S20 Person`, hashedPassword: "x",
            isActive: true, isSuperuser: true,
            role: "admin", status: "active",
        }).returning();

        await processStaffBatch([staffOf(20)]);
        const [after] = await db.select().from(users).where(eq(users.id, admin.id)).limit(1);
        expect(after!.role).toBe("admin");                // NOT "staff"
        expect(after!.isSuperuser).toBe(true);
        // ISB still owns the descriptive fields.
        expect(after!.customerType).toBe("Staff");
        expect(after!.staffType).toBe("Teacher");
        expect(after!.externalId).toBe(String(ext(20)));
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("still overwrites a role ISB owns", async () => {
        if (!dbOk) return;
        // The permissive half of the same rule — parent -> staff must work.
        const [p] = await db.insert(users).values({
            username: `${TAG}.s21`, email: `${TAG}.s21@isb.ac.th`,
            fullName: `${TAG}S21 Person`, hashedPassword: "x",
            isActive: true, isSuperuser: false,
            role: "parent", status: "active",
        }).returning();
        await processStaffBatch([staffOf(21)]);
        const [after] = await db.select().from(users).where(eq(users.id, p.id)).limit(1);
        expect(after!.role).toBe("staff");
    }, DB_TIMEOUT_MS);
});

// ── parent -> other -> parent ────────────────────────────────────────────

describe("parent <-> other", () => {
    it.if(HAS_DB)("round-trips the role, and the family reconcile drops the stale link", async () => {
        if (!dbOk) return;
        // Two guardians so /sync/families still carries the family after one
        // of them leaves — which is what lets reconcileParentLinks act.
        const fam = familyOf(30, { withParent: true });
        (fam as { secondaryParent: unknown }).secondaryParent = {
            customerId: ext(31), customerType: "Parent",
            firstName: `${TAG}P31`, lastName: "Guardian", profileImage: "",
            login: [`${TAG}.p31@parents.isb.ac.th`], smartCard: { cardNumber: CARD(31) },
        };
        await processFamilyBatch([fam]);
        const main = await userByExt(30);
        expect(main!.role).toBe("parent");

        // ISB drops the main parent from the family and sends them as "other".
        const reduced = familyOf(30, { withParent: false });
        (reduced as { mainParent: unknown }).mainParent = {
            customerId: ext(31), customerType: "Parent",
            firstName: `${TAG}P31`, lastName: "Guardian", profileImage: "",
            login: [`${TAG}.p31@parents.isb.ac.th`], smartCard: { cardNumber: CARD(31) },
        };
        await processOthersBatch([otherOf(30, { firstName: `${TAG}P30`, lastName: "Guardian" })]);
        await processFamilyBatch([reduced]);

        const asOther = await userByExt(30);
        expect(asOther!.role).toBe("other");
        const links = await db.select().from(parentChildLinks).where(eq(parentChildLinks.parentUserId, asOther!.id));
        expect(links).toEqual([]);                        // reconcileParentLinks did this, not upsertOther
        // The remaining guardian is untouched.
        expect((await userByExt(31))!.role).toBe("parent");

        // And back again.
        await processFamilyBatch([fam]);
        expect((await userByExt(30))!.role).toBe("parent");
        expect((await userByExt(30))!.email).toBe(`${TAG}.p30@parents.isb.ac.th`);
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("stops mailing a child's balance to a guardian who became a visitor card", async () => {
        if (!dbOk) return;
        await setSetting("low_balance_alert_enabled", true);
        await setSetting("low_balance_threshold", 100);

        // Sole guardian: ISB cannot express a parentless family (mainParent is
        // required), so the family drops out of the batch entirely and
        // reconcileParentLinks never runs — the link survives. This is the
        // shape where the leak was reachable.
        await processFamilyBatch([familyOf(40, { withParent: true })]);
        const guardian = await userByExt(40);
        const [kid] = await db.select().from(customers).where(eq(customers.externalId, String(ext(940)))).limit(1);
        await db.update(parentChildLinks)
            .set({ lowBalanceAlertEnabled: true, lowBalanceThreshold: "500.00" })
            .where(eq(parentChildLinks.parentUserId, guardian!.id));

        // Sanity: while they ARE a guardian, the alert goes to them.
        await checkAndSendLowBalanceAlerts(kid!.id, 1);
        const beforeRows = await db.select({ to: emailAlertsLog.recipientEmail })
            .from(emailAlertsLog).where(eq(emailAlertsLog.childCustomerId, kid!.id));
        expect(beforeRows.map((r) => r.to)).toContain(`${TAG}.p40@parents.isb.ac.th`);
        await db.delete(emailAlertsLog).where(eq(emailAlertsLog.childCustomerId, kid!.id));

        // Now they become an "other" card. The link is still there.
        await processOthersBatch([otherOf(40, { firstName: `${TAG}P40`, lastName: "Guardian" })]);
        const stillLinked = await db.select().from(parentChildLinks)
            .where(eq(parentChildLinks.parentUserId, (await userByExt(40))!.id));
        expect(stillLinked.length).toBe(1);

        await checkAndSendLowBalanceAlerts(kid!.id, 1);
        const afterRows = await db.select({ to: emailAlertsLog.recipientEmail })
            .from(emailAlertsLog).where(eq(emailAlertsLog.childCustomerId, kid!.id));
        // Nothing queued at all: their link is the only one, and it no longer
        // counts as an opt-in either.
        expect(afterRows).toEqual([]);
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("skips an alert already queued before the guardian became a visitor card", async () => {
        if (!dbOk) return;
        await setSetting("low_balance_alert_enabled", true);
        await setSetting("low_balance_threshold", 100);

        // Queue while they are still a guardian — the row exists and is pending.
        await processFamilyBatch([familyOf(45, { withParent: true })]);
        const guardian = await userByExt(45);
        const [kid] = await db.select().from(customers).where(eq(customers.externalId, String(ext(945)))).limit(1);
        await db.update(parentChildLinks)
            .set({ lowBalanceAlertEnabled: true, lowBalanceThreshold: "500.00" })
            .where(eq(parentChildLinks.parentUserId, guardian!.id));
        await checkAndSendLowBalanceAlerts(kid!.id, 1);
        const [queued] = await db.select().from(emailAlertsLog)
            .where(and(eq(emailAlertsLog.childCustomerId, kid!.id), eq(emailAlertsLog.status, "pending"))).limit(1);
        expect(queued).toBeTruthy();

        // ISB moves them to an "other" card AFTER the alert was queued. The
        // send-time re-check owns this case, not the queue-time filter — and it
        // must never actually send, so no SMTP is involved.
        await processOthersBatch([otherOf(45, { firstName: `${TAG}P45`, lastName: "Guardian" })]);
        await sendSingleLowBalanceAlert(queued!.id);

        const [after] = await db.select().from(emailAlertsLog).where(eq(emailAlertsLog.id, queued!.id)).limit(1);
        expect(after!.status).toBe("skipped");
        expect(after!.errorMessage).toMatch(/no guardian is linked/i);
    }, DB_TIMEOUT_MS);
});

// ── the guard against shadowing a live customer wallet ───────────────────

describe("/sync/others cannot shadow an active customer", () => {
    it.if(HAS_DB)("fails the record instead of stranding the student's balance", async () => {
        if (!dbOk) return;
        await processFamilyBatch([familyOf(50, { withParent: true })]);
        const [kid] = await db.select().from(customers).where(eq(customers.externalId, String(ext(950)))).limit(1);
        const [kw] = await db.select().from(wallets).where(eq(wallets.customerId, kid!.id)).limit(1);
        await db.update(wallets).set({ balance: "875.00" }).where(eq(wallets.id, kw!.id));

        // Same external_id, same physical card, sent as "other".
        const res = await processOthersBatch([
            otherOf(950, { firstName: `${TAG}K50`, lastName: "Guardian", smartCard: { cardNumber: CARD(950) } }),
        ]);
        expect(res.failed).toBe(1);
        expect(res.errors[0]!.error).toMatch(/already belongs to an active/);

        // The student's card still reaches the student's own money.
        const scan = await resolveScan(CARD(950));
        expect(scan.wallet_id).toBe(kw!.id);
        expect(scan.wallet_balance).toBeCloseTo(875, 2);
        // And the login shell was not converted behind our backs.
        const shell = await db.select({ role: users.role }).from(users)
            .where(eq(users.externalId, String(ext(950))));
        for (const r of shell) expect(r.role).not.toBe("other");
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("allows the id once that customer is no longer active", async () => {
        if (!dbOk) return;
        await processFamilyBatch([familyOf(60, { withParent: true })]);
        const [kid] = await db.select().from(customers).where(eq(customers.externalId, String(ext(960)))).limit(1);
        await db.update(customers).set({ isActive: false }).where(eq(customers.id, kid!.id));

        const res = await processOthersBatch([
            otherOf(960, { firstName: `${TAG}K60`, lastName: "Guardian", smartCard: { cardNumber: `${TAG}-new-960` } }),
        ]);
        expect(res.failed).toBe(0);
    }, DB_TIMEOUT_MS);
});
