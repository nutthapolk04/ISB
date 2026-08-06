/**
 * Wallet Adjustment Report — entity/ISB-ID resolution.
 *
 * Context: the report's third column used to be "Code" and showed the wallet
 * owner's local identifier — `users.username` for a staff/parent wallet,
 * `student_code`/`customer_code` for a student wallet. It is now "ISB ID" and
 * must show `external_id` (the PowerSchool ID) instead, falling back to the old
 * local code only when external_id hasn't been synced, so a row is never left
 * unidentifiable.
 *
 * The report had no test coverage at all before this file. Conventions mirror
 * grade_spending_limits.test.ts for the pure cases and wallet_concurrency.test.ts
 * for the DB-gated ones (`it.if(HAS_DB)` + `pingDb()` guard + uniquely tagged
 * fixture rows that are cleaned up rather than truncating tables).
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { users, wallets, walletTransactions } from "@/db/schema";
import {
    adjustmentReport,
    parseAdjDescription,
    resolveAdjustmentEntity,
    type AdjustmentCustomerLike,
    type AdjustmentUserLike,
} from "@/services/admin_reports_service";
import { classifyWalletTxKind } from "@/services/wallet_tx_classify";

/**
 * These tests INSERT and DELETE rows, so they must only ever touch a local
 * throwaway database. Bun auto-loads `backend-bun/.env`, which on this repo is
 * routinely repointed at the shared Railway/UAT instance — running the suite
 * with that active would seed junk `users`/`wallets`/`wallet_transactions` rows
 * into a database real people read reports from (a stray fixture shows up as a
 * bogus "+฿50 Adjustment Test" row in this very report). Localhost-only, and
 * loud about why when it skips.
 */
const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
/** Same allowance as wallet_concurrency.test.ts — the first Postgres connect
 *  alone can exceed bun's 5s default on a cold container. */
const DB_TIMEOUT_MS = 45_000;

beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    }
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn(
            "[adjustment_report] Skipping DB-backed cases: DATABASE_URL is not localhost. " +
            "These tests write fixture rows and must not run against a shared database.",
        );
    }
    if (HAS_DB) dbOk = await pingDb();
});

// ── Pure: entity resolution ───────────────────────────────────────────────

function customer(over: Partial<AdjustmentCustomerLike> = {}): AdjustmentCustomerLike {
    return {
        name: "Kao SUWAN",
        externalId: "35008",
        studentCode: "PS-35008",
        customerCode: "CUST-35008",
        ...over,
    };
}

function user(over: Partial<AdjustmentUserLike> = {}): AdjustmentUserLike {
    return {
        fullName: "John Taylor BURNS",
        username: "john",
        role: "staff",
        externalId: "202849",
        ...over,
    };
}

describe("resolveAdjustmentEntity — user-owned wallet (the changed branch)", () => {
    it("uses external_id as the ISB ID, NOT the username", () => {
        const e = resolveAdjustmentEntity({ user: user() });
        expect(e.code).toBe("202849");
        expect(e.code).not.toBe("john");
    });

    it("falls back to username when external_id is null", () => {
        expect(resolveAdjustmentEntity({ user: user({ externalId: null }) }).code).toBe("john");
    });

    it("falls back to username when external_id is an empty string", () => {
        // PowerSchool sync has historically written "" rather than NULL, which
        // `??` would have happily passed through as a blank ISB ID column.
        expect(resolveAdjustmentEntity({ user: user({ externalId: "" }) }).code).toBe("john");
    });

    it("reports the user's role as the entity type", () => {
        expect(resolveAdjustmentEntity({ user: user({ role: "parent" }) }).type).toBe("parent");
    });

    it("defaults the entity type to staff when role is null", () => {
        expect(resolveAdjustmentEntity({ user: user({ role: null }) }).type).toBe("staff");
    });

    it("prefers full_name for the name, falling back to username", () => {
        expect(resolveAdjustmentEntity({ user: user() }).name).toBe("John Taylor BURNS");
        expect(resolveAdjustmentEntity({ user: user({ fullName: "" }) }).name).toBe("john");
    });
});

describe("resolveAdjustmentEntity — customer-owned wallet", () => {
    it("uses external_id as the ISB ID", () => {
        expect(resolveAdjustmentEntity({ customer: customer() }).code).toBe("35008");
    });

    it("falls back to student_code when external_id is missing", () => {
        expect(resolveAdjustmentEntity({ customer: customer({ externalId: null }) }).code).toBe("PS-35008");
    });

    it("falls back to customer_code when neither external_id nor student_code exist", () => {
        const e = resolveAdjustmentEntity({ customer: customer({ externalId: null, studentCode: null }) });
        expect(e.code).toBe("CUST-35008");
    });

    it("always types a customer wallet as student", () => {
        expect(resolveAdjustmentEntity({ customer: customer() }).type).toBe("student");
    });
});

describe("resolveAdjustmentEntity — fallbacks", () => {
    it("returns the unknown placeholder when the owner row can't be found", () => {
        // A wallet whose owner was deleted mid-report must degrade, not throw.
        expect(resolveAdjustmentEntity({})).toEqual({ type: "unknown", name: "—", code: "—" });
        expect(resolveAdjustmentEntity({ customer: null, user: null }).type).toBe("unknown");
    });

    it("prefers the customer branch when both owners are somehow present", () => {
        // Defensive: wallets are single-owner, but the resolver must be
        // deterministic rather than depending on property order.
        const e = resolveAdjustmentEntity({ customer: customer(), user: user() });
        expect(e.type).toBe("student");
        expect(e.code).toBe("35008");
    });
});

// ── Pure: legacy description parsing ─────────────────────────────────────

describe("parseAdjDescription", () => {
    it("returns empty values for a null description", () => {
        expect(parseAdjDescription(null)).toEqual({ reason: "", ticket: null });
    });

    it("extracts a [ref:...] ticket", () => {
        expect(parseAdjDescription("Adjustment [ref:TCK-42] — wrong amount").ticket).toBe("TCK-42");
    });

    it("takes the reason after an em-dash separator", () => {
        expect(parseAdjDescription("Manual adjust — refund for cancelled order").reason)
            .toBe("refund for cancelled order");
    });

    it("also accepts a plain hyphen separator", () => {
        expect(parseAdjDescription("Manual adjust - duplicate charge").reason).toBe("duplicate charge");
    });

    it("uses the whole string when there is no separator", () => {
        expect(parseAdjDescription("topped up by mistake").reason).toBe("topped up by mistake");
    });

    it("returns a null ticket when no [ref:] marker is present", () => {
        expect(parseAdjDescription("Manual adjust — no ticket").ticket).toBeNull();
    });
});

// ── Pure: which writers belong in this report ────────────────────────────

/**
 * The report must contain ONLY manual corrections made on /admin/wallet-adjust.
 * Four code paths write transaction_type='ADJUSTMENT', so the type alone is not
 * a sufficient filter — these cases pin down the rule the service implements
 * (`reference_type='admin_adjustment'` in SQL, then classifyWalletTxKind() to
 * separate a manual correction from a cash top-up that shares the same tags).
 */
describe("adjustment report inclusion rule", () => {
    const kind = (referenceType: string | null, reason: string | null) =>
        classifyWalletTxKind({ transactionType: "ADJUSTMENT", referenceType, reason });

    it("counts a manual admin correction as an adjustment", () => {
        expect(kind("admin_adjustment", "Refund for duplicate charge")).toBe("adjustment");
    });

    it("counts a POS cash top-up as a top-up, not an adjustment", () => {
        // cashierTopup() delegates to adjustBalance(), so this row is
        // ADJUSTMENT + admin_adjustment and only `reason` tells them apart.
        expect(kind("admin_adjustment", "Cash top-up at POS")).toBe("topup");
    });

    it("counts a kiosk cash top-up as a top-up", () => {
        expect(kind("admin_adjustment", "Cash top-up at POS - Kiosk top-up via cash @ Kiosk 1")).toBe("topup");
    });

    it("is case-insensitive about the cash top-up reason", () => {
        expect(kind("admin_adjustment", "cash TOP-UP at pos")).toBe("topup");
    });

    it("does not treat a reason that merely mentions cash as a top-up", () => {
        // Only the "Cash top-up at POS" prefix is the machine-written marker;
        // an admin typing about cash in a correction must stay in the report.
        expect(kind("admin_adjustment", "Returned cash to parent at office")).toBe("adjustment");
    });
});

// ── DB-gated: end-to-end through adjustmentReport() ──────────────────────

interface UserWalletFixture {
    tag: string;
    /** null when seeded without one — otherwise the unique ISB ID to assert on. */
    externalId: string | null;
    userId: number;
    walletId: number;
    txId: number;
}

/**
 * Seed a user-owned wallet plus one ADJUSTMENT transaction.
 *
 * `external_id` is derived from the run-unique tag rather than hardcoded:
 * `users.external_id` carries a UNIQUE index (`ix_users_external_id`), so a
 * fixed literal makes the suite fail on the second run if a previous run was
 * interrupted (e.g. a timeout) before its cleanup executed.
 */
interface SeedOpts {
    role?: string;
    /** Defaults to what adjustBalance() writes for a real admin adjustment. */
    referenceType?: string | null;
    /** Defaults to a reason that is NOT a cash top-up. */
    reason?: string;
}

// Overloads so `withExternalId: true` call sites get a non-null `externalId`
// to assert against without sprinkling `!`.
async function seedUserAdjustment(
    opts: SeedOpts & { withExternalId: true },
): Promise<UserWalletFixture & { externalId: string }>;
async function seedUserAdjustment(
    opts: SeedOpts & { withExternalId: false },
): Promise<UserWalletFixture & { externalId: null }>;
async function seedUserAdjustment(opts: SeedOpts & {
    withExternalId: boolean;
}): Promise<UserWalletFixture> {
    const tag = `TST-ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const externalId = opts.withExternalId ? `EXT-${tag}` : null;

    const [u] = await db
        .insert(users)
        .values({
            username: tag,
            email: `${tag}@example.invalid`,
            fullName: `Adjustment Test ${tag}`,
            hashedPassword: "not-a-real-hash",
            isActive: true,
            isSuperuser: false,
            role: opts.role ?? "staff",
            externalId,
            status: "active",
        })
        .returning({ id: users.id });

    const [w] = await db
        .insert(wallets)
        .values({ userId: u.id, balance: "100.00", isActive: true })
        .returning({ id: wallets.id });

    const [tx] = await db
        .insert(walletTransactions)
        .values({
            walletId: w.id,
            transactionType: "ADJUSTMENT",
            amount: "50.00",
            balanceBefore: "100.00",
            balanceAfter: "150.00",
            createdBy: u.id,
            // Mirrors adjustBalance(): every row it writes is tagged
            // 'admin_adjustment', which is what the report now filters on.
            referenceType: opts.referenceType === undefined ? "admin_adjustment" : opts.referenceType,
            reason: opts.reason ?? `seeded by ${tag}`,
            referenceTicket: tag,
        })
        .returning({ id: walletTransactions.id });

    return { tag, externalId, userId: u.id, walletId: w.id, txId: tx.id };
}

async function cleanupUserAdjustment(f: UserWalletFixture): Promise<void> {
    await db.delete(walletTransactions).where(eq(walletTransactions.walletId, f.walletId));
    await db.delete(wallets).where(eq(wallets.id, f.walletId));
    await db.delete(users).where(eq(users.id, f.userId));
}

/** Pull one big page so the assertion doesn't depend on how much adjustment
 *  history the seeded DB already has, nor on default sort order. */
const ALL_ROWS = 5_000;

async function findReportRow(txId: number) {
    const res = await adjustmentReport({ page: 1, pageSize: ALL_ROWS });
    return res.items.find((r) => r.id === txId);
}

describe("adjustmentReport — ISB ID column", () => {
    it.if(HAS_DB)(
        "reports external_id for a staff wallet, not the username",
        async () => {
            if (!dbOk) return;
            const f = await seedUserAdjustment({ withExternalId: true });
            try {
                const row = await findReportRow(f.txId);
                expect(row).toBeDefined();
                expect(row!.entity_code).toBe(f.externalId);
                expect(row!.entity_code).not.toBe(f.tag); // f.tag is the username
                expect(row!.entity_type).toBe("staff");
                expect(row!.direction).toBe("credit");
            } finally {
                await cleanupUserAdjustment(f);
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "falls back to the username when external_id is not synced",
        async () => {
            if (!dbOk) return;
            const f = await seedUserAdjustment({ withExternalId: false });
            try {
                const row = await findReportRow(f.txId);
                expect(row).toBeDefined();
                expect(row!.entity_code).toBe(f.tag);
            } finally {
                await cleanupUserAdjustment(f);
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "keeps the role-based type filter working alongside the ISB ID change",
        async () => {
            if (!dbOk) return;
            const f = await seedUserAdjustment({ withExternalId: true, role: "parent" });
            try {
                const matching = await adjustmentReport({ page: 1, pageSize: ALL_ROWS, typeFilter: "parent" });
                expect(matching.items.find((r) => r.id === f.txId)?.entity_code).toBe(f.externalId);

                const other = await adjustmentReport({ page: 1, pageSize: ALL_ROWS, typeFilter: "student" });
                expect(other.items.find((r) => r.id === f.txId)).toBeUndefined();
            } finally {
                await cleanupUserAdjustment(f);
            }
        },
        DB_TIMEOUT_MS,
    );
});

describe("adjustmentReport — only admin adjustments from /admin/wallet-adjust", () => {
    it.if(HAS_DB)(
        "includes a manual admin correction",
        async () => {
            if (!dbOk) return;
            const f = await seedUserAdjustment({
                withExternalId: true,
                reason: "Refund for duplicate charge",
            });
            try {
                expect(await findReportRow(f.txId)).toBeDefined();
            } finally {
                await cleanupUserAdjustment(f);
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "excludes a POS cash top-up even though it shares the ADJUSTMENT type",
        async () => {
            if (!dbOk) return;
            const f = await seedUserAdjustment({
                withExternalId: true,
                reason: "Cash top-up at POS",
            });
            try {
                expect(await findReportRow(f.txId)).toBeUndefined();
            } finally {
                await cleanupUserAdjustment(f);
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "excludes a kiosk cash top-up",
        async () => {
            if (!dbOk) return;
            const f = await seedUserAdjustment({
                withExternalId: true,
                reason: "Cash top-up at POS - Kiosk top-up via cash @ Kiosk 1 (kiosk_service)",
            });
            try {
                expect(await findReportRow(f.txId)).toBeUndefined();
            } finally {
                await cleanupUserAdjustment(f);
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "excludes the opening-balance row written when a cardholder is created",
        async () => {
            if (!dbOk) return;
            const f = await seedUserAdjustment({
                withExternalId: true,
                referenceType: "initial_balance",
                reason: "Initial balance on student creation",
            });
            try {
                expect(await findReportRow(f.txId)).toBeUndefined();
            } finally {
                await cleanupUserAdjustment(f);
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "excludes an ADJUSTMENT row with no reference_type at all",
        async () => {
            if (!dbOk) return;
            const f = await seedUserAdjustment({ withExternalId: true, referenceType: null });
            try {
                expect(await findReportRow(f.txId)).toBeUndefined();
            } finally {
                await cleanupUserAdjustment(f);
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "keeps excluded rows out of the credit/debit totals, not just the page",
        async () => {
            if (!dbOk) return;
            // Aggregates are computed over the whole filtered set, so a cash
            // top-up leaking in would inflate the summary badges even when it
            // isn't on the visible page.
            const before = await adjustmentReport({ page: 1, pageSize: ALL_ROWS });
            const f = await seedUserAdjustment({
                withExternalId: true,
                reason: "Cash top-up at POS",
            });
            try {
                const after = await adjustmentReport({ page: 1, pageSize: ALL_ROWS });
                expect(after.total).toBe(before.total);
                expect(after.credit_total).toBeCloseTo(before.credit_total, 2);
            } finally {
                await cleanupUserAdjustment(f);
            }
        },
        DB_TIMEOUT_MS,
    );
});
