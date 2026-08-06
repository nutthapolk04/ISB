/**
 * Wallet Transfer Report — party (From / To) resolution.
 *
 * Context: the report used to show four flat columns — From, From Code, To,
 * To Code — where the *Code* was the owner's local identifier (student_code /
 * customer_code for a student wallet, username for a staff/parent wallet). The
 * UI now groups them into From/To each with an "ISB ID" + "Name" sub-column,
 * and ISB ID means `external_id` (the PowerSchool ID), falling back to the old
 * local code only when external_id hasn't synced so a row is never left
 * unidentifiable.
 *
 * Two things must be protected here:
 *   1. the ID precedence itself (external_id → local code), and
 *   2. that `q` search still finds a party by their OLD code, since that code
 *      is no longer on screen but users still type it.
 *
 * Conventions mirror adjustment_report.test.ts — pure cases run anywhere, the
 * DB-backed ones are gated on a localhost DATABASE_URL and clean up after
 * themselves rather than truncating.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { users, wallets, walletTransactions } from "@/db/schema";
import {
    transferReport,
    resolveTransferParty,
    TRANSFER_PARTY_UNKNOWN,
    type TransferCustomerLike,
    type TransferUserLike,
    type TransferDepartmentLike,
} from "@/services/admin_reports_service";

/**
 * Localhost-only, for the same reason spelled out in adjustment_report.test.ts:
 * bun auto-loads `backend-bun/.env`, which on this repo is routinely repointed
 * at the shared Railway instance, and these cases INSERT fixture rows that
 * would then surface as bogus transfers in a report real people read.
 */
const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
const DB_TIMEOUT_MS = 45_000;

beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    }
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn(
            "[transfer_report] Skipping DB-backed cases: DATABASE_URL is not localhost. " +
            "These tests write fixture rows and must not run against a shared database.",
        );
    }
    if (HAS_DB) dbOk = await pingDb();
});

// ── Helpers ───────────────────────────────────────────────────────────────

function customer(over: Partial<TransferCustomerLike> = {}): TransferCustomerLike {
    return {
        name: "Somchai Student",
        externalId: "202849",
        studentCode: "STU-1",
        customerCode: "CUS-1",
        ...over,
    } as TransferCustomerLike;
}

function user(over: Partial<TransferUserLike> = {}): TransferUserLike {
    return {
        fullName: "Jane Cashier",
        username: "jane",
        externalId: "900123",
        ...over,
    } as TransferUserLike;
}

function department(over: Partial<TransferDepartmentLike> = {}): TransferDepartmentLike {
    return {
        departmentName: "Science Dept",
        departmentCode: "SCI",
        ...over,
    } as TransferDepartmentLike;
}

// ── Pure: customer-owned wallets ──────────────────────────────────────────

describe("resolveTransferParty — customer wallet", () => {
    it("shows external_id as the ISB ID", () => {
        expect(resolveTransferParty({ customer: customer() })).toEqual({
            name: "Somchai Student",
            code: "202849",
        });
    });

    it("falls back to student_code when external_id is null", () => {
        const p = resolveTransferParty({ customer: customer({ externalId: null }) });
        expect(p.code).toBe("STU-1");
    });

    it("falls back to student_code when external_id is an empty string", () => {
        // PowerSchool sync has historically written "" rather than NULL, which
        // is why the resolver uses `||` and not `??`. With `??` this row would
        // render a blank ISB ID column.
        const p = resolveTransferParty({ customer: customer({ externalId: "" }) });
        expect(p.code).toBe("STU-1");
    });

    it("falls back past a blank student_code to customer_code", () => {
        const p = resolveTransferParty({
            customer: customer({ externalId: "", studentCode: "" }),
        });
        expect(p.code).toBe("CUS-1");
    });

    it("never returns an empty ISB ID when at least one code exists", () => {
        for (const c of [
            customer(),
            customer({ externalId: null }),
            customer({ externalId: null, studentCode: null }),
        ]) {
            expect(resolveTransferParty({ customer: c }).code).toBeTruthy();
        }
    });
});

// ── Pure: user-owned wallets ──────────────────────────────────────────────

describe("resolveTransferParty — user wallet", () => {
    it("shows external_id as the ISB ID and full_name as the name", () => {
        expect(resolveTransferParty({ user: user() })).toEqual({
            name: "Jane Cashier",
            code: "900123",
        });
    });

    it("falls back to username when external_id is missing", () => {
        expect(resolveTransferParty({ user: user({ externalId: null }) }).code).toBe("jane");
        expect(resolveTransferParty({ user: user({ externalId: "" }) }).code).toBe("jane");
    });

    it("falls back to username for the display name when full_name is blank", () => {
        // users.full_name is NOT NULL in the schema, so "" is the realistic
        // blank — a null here wouldn't typecheck and can't occur.
        expect(resolveTransferParty({ user: user({ fullName: "" }) }).name).toBe("jane");
    });
});

// ── Pure: department-owned wallets, and unknown ───────────────────────────

describe("resolveTransferParty — department wallet", () => {
    it("uses department_code, the only ID a department has", () => {
        // departments carry no external_id column — if that ever changes this
        // test is the reminder to extend the precedence chain here too.
        expect(resolveTransferParty({ department: department() })).toEqual({
            name: "Science Dept",
            code: "SCI",
        });
    });
});

describe("resolveTransferParty — owner precedence and fallbacks", () => {
    it("prefers customer over user over department", () => {
        // A wallet is owned by exactly one of the three; this pins the order so
        // a future caller passing extras can't silently flip which side wins.
        expect(resolveTransferParty({ customer: customer(), user: user(), department: department() }).code)
            .toBe("202849");
        expect(resolveTransferParty({ user: user(), department: department() }).code).toBe("900123");
    });

    it("returns the placeholder party when the wallet has no owner", () => {
        expect(resolveTransferParty({})).toEqual(TRANSFER_PARTY_UNKNOWN);
        expect(resolveTransferParty({ customer: null, user: null, department: null }))
            .toEqual(TRANSFER_PARTY_UNKNOWN);
    });

    it("returns a copy, so a caller mutating a row can't poison later rows", () => {
        const a = resolveTransferParty({});
        a.name = "MUTATED";
        expect(resolveTransferParty({}).name).toBe("—");
        expect(TRANSFER_PARTY_UNKNOWN.name).toBe("—");
    });
});

// ── DB-backed: end-to-end shape, ISB ID column, legacy-code search ────────

const TAG = `tr-${Date.now().toString(36)}`;

async function seedUser(opts: {
    suffix: string;
    externalId: string | null;
    fullName: string;
}): Promise<{ userId: number; walletId: number; username: string }> {
    const username = `${TAG}-${opts.suffix}`;
    const [u] = await db
        .insert(users)
        .values({
            username,
            email: `${username}@example.test`,
            hashedPassword: "x",
            fullName: opts.fullName,
            role: "parent",
            externalId: opts.externalId,
            isActive: true,
            isSuperuser: false,
        })
        .returning();
    try {
        const [w] = await db
            .insert(wallets)
            .values({ userId: u.id, balance: "100.00", isActive: true })
            .returning();
        return { userId: u.id, walletId: w.id, username };
    } catch (e) {
        // Don't leave a half-seeded user behind if the wallet insert fails —
        // the caller's finally block hasn't started yet at this point.
        await db.delete(users).where(eq(users.id, u.id));
        throw e;
    }
}

describe("transferReport (DB)", () => {
    it.if(HAS_DB)(
        "renders external_id as the code, falls back to username, and still finds a party by username",
        async () => {
            if (!dbOk) return;
            // `withExt` has an ISB ID; `noExt` does not, so it must fall back.
            const withExt = await seedUser({ suffix: "a", externalId: `${TAG}-EXT`, fullName: "Alice Sender" });
            const noExt = await seedUser({ suffix: "b", externalId: null, fullName: "Bob Receiver" });
            let txId: number | null = null;
            try {
                // transferWithinFamily() writes two legs; the report reads only
                // the DEDUCTION one, with referenceId pointing at the
                // destination wallet. Seed exactly that leg.
                const [tx] = await db
                    .insert(walletTransactions)
                    .values({
                        walletId: withExt.walletId,
                        transactionType: "DEDUCTION",
                        amount: "25.00",
                        balanceBefore: "100.00",
                        balanceAfter: "75.00",
                        description: `Transfer to Bob Receiver — ${TAG} note`,
                        referenceType: "family_transfer",
                        referenceId: noExt.walletId,
                        createdBy: withExt.userId,
                    })
                    .returning();
                txId = tx.id;

                const res = await transferReport({ q: TAG, page: 1, pageSize: 50 });
                const row = res.items.find((r) => r.id === txId);
                expect(row).toBeDefined();

                // From side: external_id wins over username.
                expect(row!.from_code).toBe(`${TAG}-EXT`);
                expect(row!.from_name).toBe("Alice Sender");
                // To side: no external_id, so the username shows instead of a blank.
                expect(row!.to_code).toBe(noExt.username);
                expect(row!.to_name).toBe("Bob Receiver");
                expect(row!.amount).toBe(25);
                expect(row!.note).toBe(`${TAG} note`);

                // The regression this guards: `from_code` is external_id now, so
                // searching by the sender's USERNAME matches nothing visible on
                // the row. walletSearchAliases() must keep it findable.
                const byUsername = await transferReport({
                    q: withExt.username,
                    page: 1,
                    pageSize: 50,
                });
                expect(byUsername.items.some((r) => r.id === txId)).toBe(true);

                // And by the ISB ID itself.
                const byExt = await transferReport({ q: `${TAG}-EXT`, page: 1, pageSize: 50 });
                expect(byExt.items.some((r) => r.id === txId)).toBe(true);
            } finally {
                // FK order: transaction → wallet → user.
                if (txId !== null) await db.delete(walletTransactions).where(eq(walletTransactions.id, txId));
                await db.delete(wallets).where(eq(wallets.id, withExt.walletId));
                await db.delete(wallets).where(eq(wallets.id, noExt.walletId));
                await db.delete(users).where(eq(users.id, withExt.userId));
                await db.delete(users).where(eq(users.id, noExt.userId));
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "excludes the TOPUP leg so a transfer is never counted twice or shown backwards",
        async () => {
            if (!dbOk) return;
            const a = await seedUser({ suffix: "c", externalId: `${TAG}-C`, fullName: "Carol" });
            const b = await seedUser({ suffix: "d", externalId: `${TAG}-D`, fullName: "Dave" });
            const ids: number[] = [];
            try {
                for (const leg of [
                    {
                        walletId: a.walletId,
                        transactionType: "DEDUCTION" as const,
                        amount: "10.00",
                        referenceId: b.walletId,
                    },
                    {
                        walletId: b.walletId,
                        transactionType: "TOPUP" as const,
                        amount: "10.00",
                        referenceId: a.walletId,
                    },
                ]) {
                    const [tx] = await db
                        .insert(walletTransactions)
                        .values({
                            ...leg,
                            balanceBefore: "100.00",
                            balanceAfter: "90.00",
                            description: `Transfer — ${TAG} pair`,
                            referenceType: "family_transfer",
                            createdBy: a.userId,
                        })
                        .returning();
                    ids.push(tx.id);
                }

                const res = await transferReport({ q: `${TAG} pair`, page: 1, pageSize: 50 });
                const mine = res.items.filter((r) => ids.includes(r.id));
                expect(mine).toHaveLength(1);
                // The surviving row is the DEDUCTION leg, i.e. Carol → Dave.
                expect(mine[0].from_code).toBe(`${TAG}-C`);
                expect(mine[0].to_code).toBe(`${TAG}-D`);
            } finally {
                for (const id of ids) {
                    await db.delete(walletTransactions).where(eq(walletTransactions.id, id));
                }
                await db.delete(wallets).where(eq(wallets.id, a.walletId));
                await db.delete(wallets).where(eq(wallets.id, b.walletId));
                await db.delete(users).where(eq(users.id, a.userId));
                await db.delete(users).where(eq(users.id, b.userId));
            }
        },
        DB_TIMEOUT_MS,
    );
});
