/**
 * ISB `/sync/others` — visitor purchase cards (users.role = "other").
 *
 * A cardholder with no email, no password anybody knows, and no portal: it
 * exists to own a wallet and a card number, tops up at a kiosk or at a Store
 * shop that allows top-up, and spends at POS like anyone else.
 *
 * Four properties are load-bearing enough to pin here:
 *
 *  1. CANNOT LOG IN, ON ANY ENVIRONMENT. Not "the password is unguessable" and
 *     not "prod blocks the sync placeholder" (passwordLoginBlockedInCurrentEnv
 *     covers prod/uat only) — the role itself is refused, before credentials
 *     are examined, on every entry point plus the shared createTokens funnel.
 *  2. family_code GRANTS NOTHING. ISB sends one and we store it verbatim, but
 *     `users.family_code` is an authorization boundary for co-parents; a match
 *     must not hand a parent someone else's visitor card.
 *  3. THE SWEEP GATE IS SCOPED PER ROLE. Sharing one gate with the staff sweep
 *     would let ordinary /sync/staffs traffic authorise deactivating every
 *     visitor card on the day /sync/others ships but ISB hasn't wired it up.
 *  4. is_active IS THE KILL SWITCH, since there is no card-freeze column for
 *     users. Deactivating must close the POS path too, not just search.
 *
 * NOT pinned here: rejecting duplicate card numbers. users.card_uid is a
 * plain, non-unique index (unlike customers.card_uid), so two users can share
 * a card number and getUserPayerByCard's `.limit(1)` — no ORDER BY — then
 * resolves to an arbitrary one of them. Adding the constraint was proposed and
 * dropped twice in 2026-08: ISB's real batches were confirmed to contain
 * duplicate cards, so enforcing uniqueness would fail those records on every
 * sync and the staleness sweep would then deactivate the people involved. The
 * duplicate-tolerant behaviour is pinned below instead, and the wrong-wallet
 * consequence is a known open issue pending a conversation with ISB.
 *
 * Conventions mirror the other DB-backed suites: localhost-only, run-unique
 * fixtures, FK-ordered cleanup in `finally`.
 */
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { userLoginEmails, users, wallets } from "@/db/schema";
import { processOthersBatch, type IsbOther } from "@/services/isb_sync_service";
import { sweepStaleOthers } from "@/services/other_sweep_service";
import { login, mockSso } from "@/services/auth_service";
import { getUserPayerByCard, resolveScan } from "@/services/user_service";
import { searchCustomers } from "@/services/customer_service";
import { userCanAccessWallet } from "@/services/topup_service";
import { resolveAdjustmentEntity } from "@/services/admin_reports_service";
import { SYNC_PLACEHOLDER_PASSWORD } from "@/lib/placeholder_password";

const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
const DB_TIMEOUT_MS = 45_000;
const TAG = `oth-${Date.now().toString(36)}`;

/** ISB reserves the 91xxx external_id range for "Other". Keep fixtures inside
 *  it but salted per run so concurrent runs can't collide on external_id,
 *  which IS unique, and so a fixture card number can never shadow a real
 *  one. */
const IDBASE = 9_100_000 + (Date.now() % 90_000);
const extId = (n: number) => IDBASE + n;
const CARD = (n: number) => `${TAG}-card-${n}`;

function otherPayload(n: number, over: Partial<IsbOther> = {}): IsbOther {
    return {
        customerId: extId(n),
        customerType: "Other",
        familyCode: 91000 + n,
        firstName: `${TAG}First${n}`,
        lastName: `Visitor${n}`,
        smartCard: { cardNumber: CARD(n) },
        login: [],
        ...over,
    };
}

async function rowByExt(n: number) {
    const [r] = await db.select().from(users).where(eq(users.externalId, String(extId(n)))).limit(1);
    return r;
}

async function cleanup() {
    // Match on full_name, NOT username: upsertOther derives username from
    // external_id (`other-<id>`), so it never contains TAG and a
    // username-based predicate silently deleted nothing — leaking every
    // fixture row into the database. Every fixture in this file, including
    // the parent/staff/co-parent ones, carries TAG in full_name.
    const rows = await db.select({ id: users.id }).from(users).where(like(users.fullName, `%${TAG}%`));
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;
    // FK order: login emails and wallets both reference users.
    await db.delete(userLoginEmails).where(inArray(userLoginEmails.userId, ids));
    await db.delete(wallets).where(inArray(wallets.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
}

beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn(
            "[isb_sync_others] Skipping DB-backed cases: DATABASE_URL is not localhost. " +
            "These tests write fixture rows and must not run against a shared database.",
        );
    }
    if (HAS_DB) dbOk = await pingDb();
    if (dbOk) await cleanup();
});

afterAll(async () => {
    if (dbOk) await cleanup();
});

// ── Pure ──────────────────────────────────────────────────────────────────

describe("resolveAdjustmentEntity — role 'other' vs. a missing owner", () => {
    it("gives role 'other' its own bucket", () => {
        const e = resolveAdjustmentEntity({
            user: { role: "other", fullName: "Jane Visitor", username: "other-91234", externalId: "91234" },
        });
        expect(e.type).toBe("other");
        expect(e.code).toBe("91234");
    });

    it("still reports an unreachable owner as 'unknown', NOT 'other'", () => {
        // These used to share the "other" filter bucket. Once "other" became a
        // real role, one filter meaning both "visitor card" and "wallet owner
        // no longer exists" would silently mix them in the same export.
        expect(resolveAdjustmentEntity({}).type).toBe("unknown");
    });
});

// ── DB-backed ─────────────────────────────────────────────────────────────

describe("processOthersBatch", () => {
    it.if(HAS_DB)("creates the row with role=other, a wallet, and no login email", async () => {
        if (!dbOk) return;
        const r = await processOthersBatch([otherPayload(1)]);
        expect(r).toEqual({ success: 1, failed: 0, errors: [] });

        const u = await rowByExt(1);
        expect(u).toBeTruthy();
        expect(u!.role).toBe("other");
        expect(u!.customerType).toBe("Other");
        expect(u!.isActive).toBe(true);
        expect(u!.status).toBe("active");
        expect(u!.cardUid).toBe(CARD(1));
        // Stored verbatim per the 2026-08 decision — see the family_code tests.
        expect(u!.familyCode).toBe("91001");
        // Wallet eagerly created: getUserPayerByCard 409s without one, so a
        // freshly synced card would be untappable at POS.
        const [w] = await db.select().from(wallets).where(eq(wallets.userId, u!.id)).limit(1);
        expect(w).toBeTruthy();
        // Nothing SSO-resolvable on file.
        const le = await db.select().from(userLoginEmails).where(eq(userLoginEmails.userId, u!.id));
        expect(le).toEqual([]);
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("is idempotent and refreshes last_synced_at", async () => {
        if (!dbOk) return;
        await processOthersBatch([otherPayload(2)]);
        const first = await rowByExt(2);
        await new Promise((r) => setTimeout(r, 10));
        const again = await processOthersBatch([otherPayload(2)]);
        expect(again.success).toBe(1);
        const second = await rowByExt(2);
        expect(second!.id).toBe(first!.id);
        expect(new Date(second!.lastSyncedAt!).getTime())
            .toBeGreaterThanOrEqual(new Date(first!.lastSyncedAt!).getTime());
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("does NOT store the sync placeholder password", async () => {
        if (!dbOk) return;
        await processOthersBatch([otherPayload(3)]);
        const u = await rowByExt(3);
        // The whole point of not reusing SYNC_PLACEHOLDER_PASSWORD: that value
        // is only rejected on prod/uat, so a card carrying it would be
        // password-loginable everywhere else.
        expect(await Bun.password.verify(SYNC_PLACEHOLDER_PASSWORD, u!.hashedPassword)).toBe(false);
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("ignores a login[] array if ISB ever sends one", async () => {
        if (!dbOk) return;
        const hostile = `${TAG}-injected@isb.ac.th`;
        const r = await processOthersBatch([otherPayload(4, { login: [hostile] })]);
        // Accepted, not rejected — but never honoured anywhere.
        expect(r.success).toBe(1);
        const u = await rowByExt(4);
        expect(u!.email).not.toBe(hostile);
        expect(u!.username).not.toBe(hostile.split("@")[0]);
        const le = await db.select().from(userLoginEmails).where(eq(userLoginEmails.userId, u!.id));
        expect(le).toEqual([]);
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("accepts a duplicate card number — documented, not endorsed", async () => {
        if (!dbOk) return;
        await processOthersBatch([otherPayload(5)]);
        // Same card number, different person. ISB's real batches do this, and
        // users.card_uid has no unique index, so the record is accepted.
        // Pinned so the behaviour is visible in the suite rather than a
        // surprise in prod: whoever revisits the unique-index question will
        // see this test fail and know exactly what they changed.
        const r = await processOthersBatch([otherPayload(6, { smartCard: { cardNumber: CARD(5) } })]);
        expect(r.failed).toBe(0);
        const dupes = await db
            .select({ n: sql<string>`COUNT(*)` })
            .from(users)
            .where(eq(users.cardUid, CARD(5)));
        expect(Number(dupes[0]!.n)).toBe(2);

        // And this is the open issue: a tap on that card resolves to ONE of
        // the two rows with nothing deciding which. Assert only that it lands
        // on one of them — asserting a specific row would be asserting
        // Postgres's scan order, which is exactly what isn't guaranteed.
        const hit = await getUserPayerByCard(CARD(5));
        expect([String(extId(5)), String(extId(6))]).toContain(hit.external_id ?? "");
    }, DB_TIMEOUT_MS);
});

describe("login is impossible for role 'other'", () => {
    it.if(HAS_DB)("rejects password login even with the correct username", async () => {
        if (!dbOk) return;
        await processOthersBatch([otherPayload(10)]);
        const u = await rowByExt(10);
        // Not a guess: this is the exact username the sync generated. The role
        // gate fires before the password is examined, so any password fails.
        await expect(login(u!.username, SYNC_PLACEHOLDER_PASSWORD)).rejects.toThrow(/Invalid username or password/);
        await expect(login(u!.username, "anything-at-all")).rejects.toThrow(/Invalid username or password/);
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("rejects SSO by the row's own synthetic email", async () => {
        if (!dbOk) return;
        await processOthersBatch([otherPayload(11)]);
        const u = await rowByExt(11);
        // findUserByAnyLoginEmail matches users.email directly, so the
        // synthetic address IS resolvable to this row — the role check, not
        // the address being unreachable, is what stops the login.
        await expect(mockSso(u!.email)).rejects.toThrow(/not registered/);
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("holds regardless of APP_ENV", async () => {
        if (!dbOk) return;
        await processOthersBatch([otherPayload(12)]);
        const u = await rowByExt(12);
        const saved = process.env.APP_ENV;
        try {
            // "local" is exactly the case passwordLoginBlockedInCurrentEnv()
            // does NOT cover, which is why the role gate has to exist.
            process.env.APP_ENV = "local";
            await expect(login(u!.username, SYNC_PLACEHOLDER_PASSWORD)).rejects.toThrow(/Invalid username or password/);
            await expect(mockSso(u!.email)).rejects.toThrow(/not registered/);
        } finally {
            if (saved === undefined) delete process.env.APP_ENV;
            else process.env.APP_ENV = saved;
        }
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("cannot log in even if someone sets a real password on the row", async () => {
        if (!dbOk) return;
        await processOthersBatch([otherPayload(13)]);
        const u = await rowByExt(13);
        const pw = "Str0ng-Password!";
        await db.update(users)
            .set({ hashedPassword: await Bun.password.hash(pw, { algorithm: "bcrypt", cost: 4 }) })
            .where(eq(users.id, u!.id));
        // Proves the gate is the role, not the hash.
        await expect(login(u!.username, pw)).rejects.toThrow(/Invalid username or password/);
    }, DB_TIMEOUT_MS);
});

describe("family_code is metadata, not a permission", () => {
    it.if(HAS_DB)("does not let a parent sharing the family_code reach the card's wallet", async () => {
        if (!dbOk) return;
        await processOthersBatch([otherPayload(20)]);
        const card = await rowByExt(20);
        const [cardWallet] = await db.select().from(wallets).where(eq(wallets.userId, card!.id)).limit(1);

        // A parent that ISB happened to give the same family_code.
        const [parent] = await db.insert(users).values({
            username: `${TAG}-parent`, email: `${TAG}-parent@parents.isb.ac.th`,
            fullName: `${TAG} Parent`, hashedPassword: "x",
            isActive: true, isSuperuser: false,
            role: "parent", status: "active",
            familyCode: card!.familyCode,
        }).returning();

        const caller = {
            sub: String(parent.id), username: parent.username,
            roles: ["parent"], is_superuser: false,
        } as never;
        expect(await userCanAccessWallet(caller, cardWallet!.id)).toBe(false);
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("still lets two real parents in one family reach each other", async () => {
        if (!dbOk) return;
        // Guards the fix: the exclusion must be scoped to role="other", not a
        // blanket removal of the co-parent rule.
        const fc = `${91900}`;
        const mk = async (suffix: string) => (await db.insert(users).values({
            username: `${TAG}-co-${suffix}`, email: `${TAG}-co-${suffix}@parents.isb.ac.th`,
            fullName: `${TAG} Co ${suffix}`, hashedPassword: "x",
            isActive: true, isSuperuser: false,
            role: "parent", status: "active", familyCode: fc,
        }).returning())[0];
        const a = await mk("a");
        const b = await mk("b");
        const [wb] = await db.insert(wallets).values({ userId: b.id, balance: "0", isActive: true }).returning();
        const caller = {
            sub: String(a.id), username: a.username, roles: ["parent"], is_superuser: false,
        } as never;
        expect(await userCanAccessWallet(caller, wb.id)).toBe(true);
    }, DB_TIMEOUT_MS);
});

describe("the card at POS and at a cashier", () => {
    it.if(HAS_DB)("resolves by card tap and by ISB id, and is searchable by name", async () => {
        if (!dbOk) return;
        await processOthersBatch([otherPayload(30)]);
        const byCard = await getUserPayerByCard(CARD(30));
        expect(byCard.role).toBe("other");
        expect(byCard.external_id).toBe(String(extId(30)));

        const scan = await resolveScan(CARD(30));
        expect(scan.matched_by).toBe("user_card_uid");

        // The Store cashier top-up path: /customers/search unions users, and
        // role "other" had to be added to its allowlist to appear at all.
        const hits = await searchCustomers({ q: `${TAG}First30`, limit: 10 } as never);
        expect(hits.some((h) => h.user_id === (byCard.user_id))).toBe(true);
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("stops working the moment the card is deactivated", async () => {
        if (!dbOk) return;
        await processOthersBatch([otherPayload(31)]);
        const u = await rowByExt(31);
        await db.update(users).set({ isActive: false, status: "inactive" }).where(eq(users.id, u!.id));

        // There is no card-freeze column for users, so is_active is the only
        // kill switch — it has to close the POS payment path, not just search.
        await expect(getUserPayerByCard(CARD(31))).rejects.toThrow(/inactive/i);
        const hits = await searchCustomers({ q: `${TAG}First31`, limit: 10 } as never);
        expect(hits.some((h) => h.user_id === u!.id)).toBe(false);
    }, DB_TIMEOUT_MS);
});

describe("sweepStaleOthers", () => {
    /**
     * The gate reads "has ANY role='other' row been touched in the last 2h",
     * so pre-existing rows in this database would otherwise decide the
     * outcome and make these cases pass either way. Park every OTHER card
     * (ours included) at a known-stale timestamp, then move only the ones a
     * case is about — and put everything back afterwards.
     *
     * Deliberately does NOT call sweepStaleStaff(): that sweep deactivates
     * stale staff AND nulls their family_code AND deletes their
     * parent_child_links, none of which is recoverable, so running it for
     * real against a shared local database is not an acceptable way to assert
     * anything. What matters here is only that the "other" gate ignores staff
     * activity, which a fresh staff row alone demonstrates.
     */
    const STALE = new Date(Date.now() - 48 * 3600_000).toISOString();
    const parked: Array<{ id: number; lastSyncedAt: string | null; isActive: boolean }> = [];

    async function parkAllOthers() {
        const rows = await db.select({ id: users.id, lastSyncedAt: users.lastSyncedAt, isActive: users.isActive })
            .from(users).where(eq(users.role, "other"));
        parked.length = 0;
        parked.push(...rows);
        if (rows.length > 0) {
            await db.update(users).set({ lastSyncedAt: STALE }).where(inArray(users.id, rows.map((r) => r.id)));
        }
    }

    async function unparkAllOthers() {
        for (const r of parked) {
            await db.update(users)
                .set({ lastSyncedAt: r.lastSyncedAt, isActive: r.isActive, status: r.isActive ? "active" : "inactive" })
                .where(eq(users.id, r.id));
        }
        parked.length = 0;
    }

    it.if(HAS_DB)("refuses to run when no 'other' card has been confirmed recently", async () => {
        if (!dbOk) return;
        await processOthersBatch([otherPayload(40)]);
        await parkAllOthers();
        try {
            const res = await sweepStaleOthers(3);
            // Nothing confirmed within the window → refuse outright rather
            // than deactivate every visitor card because the pipeline is down.
            expect(res.skippedNoRecentActivity).toBe(true);
            expect(res.othersSwept).toBe(0);
            expect((await rowByExt(40))!.isActive).toBe(true);
        } finally {
            await unparkAllOthers();
        }
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("staff activity does NOT authorise sweeping 'other' cards", async () => {
        if (!dbOk) return;
        // The exact day-one scenario this sweep was split out to prevent:
        // /sync/others has never fired, so every visitor card is stale, while
        // /sync/staffs is healthy. One shared gate would sweep them all.
        await processOthersBatch([otherPayload(41)]);
        await parkAllOthers();
        try {
            await db.insert(users).values({
                username: `${TAG}-staff`, email: `${TAG}-staff@isb.ac.th`,
                fullName: `${TAG} Staff`, hashedPassword: "x",
                isActive: true, isSuperuser: false,
                role: "staff", status: "active",
                lastSyncedAt: new Date().toISOString(),
            });

            const res = await sweepStaleOthers(3);
            expect(res.skippedNoRecentActivity).toBe(true);
            expect((await rowByExt(41))!.isActive).toBe(true);
        } finally {
            await unparkAllOthers();
        }
    }, DB_TIMEOUT_MS);

    it.if(HAS_DB)("deactivates a stale card once the gate is open, and a resync revives it", async () => {
        if (!dbOk) return;
        await processOthersBatch([otherPayload(42), otherPayload(43)]);
        await parkAllOthers();
        try {
            // 42 is the only recently-confirmed card, so it alone holds the
            // gate open; 43 is the sweep target.
            const fresh = await rowByExt(42);
            await db.update(users).set({ lastSyncedAt: new Date().toISOString() }).where(eq(users.id, fresh!.id));

            const res = await sweepStaleOthers(3);
            expect(res.skippedNoRecentActivity).toBeFalsy();
            expect(res.externalIdsSwept).toContain(String(extId(43)));
            const swept = await rowByExt(43);
            expect(swept!.isActive).toBe(false);
            expect(swept!.status).toBe("inactive");
            // family_code survives deactivation (unlike the staff sweep, which
            // nulls it) so a returning card is still identifiable.
            expect(swept!.familyCode).toBe("91043");
            // The card holding the gate open is untouched.
            expect((await rowByExt(42))!.isActive).toBe(true);

            // ISB names it again → back in service.
            await processOthersBatch([otherPayload(43)]);
            const revived = await rowByExt(43);
            expect(revived!.isActive).toBe(true);
            expect(revived!.status).toBe("active");
        } finally {
            await unparkAllOthers();
        }
    }, DB_TIMEOUT_MS);
});
