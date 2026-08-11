/**
 * Transaction Report — the ID column.
 *
 * It used to fall through `student_code → customer_code → username →
 * department_code`, which put three unrelated formats in one column: a student
 * showed `202324` or `ISB-ID-23750` depending on which import created them, and
 * a staff purchase showed a login name like `phatthab` that reconciles against
 * nothing. It is now one rule — the payer's ISB ID (`external_id`), or the
 * department code when a budget paid.
 *
 * Deliberately no fallback. A payer without an external_id shows `—`; the blank
 * is the signal that the record needs an ISB ID, and reinstating a fallback
 * would quietly bring the mixed formats back. Note this is stricter than the
 * Wallet Adjustment Report, which does still fall back (see
 * adjustment_report.test.ts) — if that ever gets unified, unify it knowingly.
 *
 * The same rule has to hold for the non-sale rows (top-up / adjustment /
 * transfer), which are built from a separate query further down the service and
 * are the easy half to forget.
 *
 * Conventions mirror adjustment_report.test.ts: localhost-only DB, run-unique
 * fixtures, FK-ordered cleanup in `finally`.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { inArray } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import {
    customers,
    customerTypes,
    departments,
    receipts,
    users,
    walletTransactions,
    wallets,
} from "@/db/schema";
import { transactionReport } from "@/services/admin_reports_service";

const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
const DB_TIMEOUT_MS = 45_000;

const SHOP_ID = "S0001";
const TAG = `trid-${Date.now().toString(36)}`;
// Far enough out that no real or leftover row shares the window.
const DAY = "2032-05-09";

beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    }
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn(
            "[transaction_report_payer_id] Skipping DB-backed cases: DATABASE_URL is not localhost. " +
            "These tests write fixture rows and must not run against a shared database.",
        );
    }
    if (HAS_DB) dbOk = await pingDb();
});

const customerIds: number[] = [];
const userIds: number[] = [];
const departmentIds: number[] = [];
const walletIds: number[] = [];
const receiptIds: number[] = [];
const walletTxIds: number[] = [];

async function seedCustomer(opts: { code: string; externalId: string | null; studentCode?: string | null }): Promise<number> {
    const [ct] = await db.select({ id: customerTypes.id }).from(customerTypes).limit(1);
    if (!ct) throw new Error("No customer_types row — seed the DB first");
    const [c] = await db
        .insert(customers)
        .values({
            customerCode: opts.code,
            name: `${opts.code} fixture`,
            customerTypeId: ct.id,
            studentCode: opts.studentCode ?? opts.code.replace(/^PS-/, ""),
            externalId: opts.externalId,
            isActive: true,
            cardFrozen: false,
            customerKind: "student",
        })
        .returning({ id: customers.id });
    customerIds.push(c.id);
    return c.id;
}

async function seedUser(opts: { username: string; externalId: string | null }): Promise<number> {
    const [u] = await db
        .insert(users)
        .values({
            username: opts.username,
            email: `${opts.username}@fixture.invalid`,
            fullName: `${opts.username} fixture`,
            hashedPassword: "x",
            isActive: true,
            isSuperuser: false,
            role: "parent",
            externalId: opts.externalId,
        })
        .returning({ id: users.id });
    userIds.push(u.id);
    return u.id;
}

async function seedDepartment(code: string): Promise<number> {
    const [d] = await db
        .insert(departments)
        .values({
            departmentCode: code,
            departmentName: `${code} fixture`,
            annualBudget: "0",
            currentYear: 2032,
            isActive: true,
        })
        .returning({ id: departments.id });
    departmentIds.push(d.id);
    return d.id;
}

async function seedWallet(owner: { customerId?: number; userId?: number; departmentId?: number }): Promise<number> {
    const [w] = await db
        .insert(wallets)
        .values({
            customerId: owner.customerId ?? null,
            userId: owner.userId ?? null,
            departmentId: owner.departmentId ?? null,
            balance: "0",
            isActive: true,
        })
        .returning({ id: wallets.id });
    walletIds.push(w.id);
    return w.id;
}

async function seedReceipt(opts: {
    suffix: string;
    total: number;
    customerId?: number | null;
    payerUserId?: number | null;
    payerDepartmentId?: number | null;
}): Promise<void> {
    const [r] = await db
        .insert(receipts)
        .values({
            receiptNumber: `R-${TAG}-${opts.suffix}`,
            transactionDate: `${DAY}T10:00:00+07:00`,
            transactionMode: "SALE",
            shopId: SHOP_ID,
            subtotal: opts.total.toFixed(2),
            discount: "0.00",
            tax: "0.00",
            total: opts.total.toFixed(2),
            paymentMethod: opts.payerDepartmentId ? "DEPARTMENT" : "CASH",
            status: "ACTIVE",
            customerId: opts.customerId ?? null,
            payerUserId: opts.payerUserId ?? null,
            payerDepartmentId: opts.payerDepartmentId ?? null,
            createdBy: 1,
        })
        .returning({ id: receipts.id });
    receiptIds.push(r.id);
}

/** An ADJUSTMENT on a wallet — lands in the report's non-sale query. */
async function seedAdjustment(walletId: number, amount: number): Promise<void> {
    const [t] = await db
        .insert(walletTransactions)
        .values({
            walletId,
            transactionType: "ADJUSTMENT",
            amount: amount.toFixed(2),
            balanceBefore: "0.00",
            balanceAfter: amount.toFixed(2),
            createdAt: `${DAY}T11:00:00+07:00`,
            createdBy: 1,
            description: `${TAG} adjustment`,
        })
        .returning({ id: walletTransactions.id });
    walletTxIds.push(t.id);
}

async function cleanup(): Promise<void> {
    if (walletTxIds.length) {
        await db.delete(walletTransactions).where(inArray(walletTransactions.id, walletTxIds));
        walletTxIds.length = 0;
    }
    if (receiptIds.length) {
        await db.delete(receipts).where(inArray(receipts.id, receiptIds));
        receiptIds.length = 0;
    }
    if (walletIds.length) {
        await db.delete(wallets).where(inArray(wallets.id, walletIds));
        walletIds.length = 0;
    }
    if (customerIds.length) {
        await db.delete(customers).where(inArray(customers.id, customerIds));
        customerIds.length = 0;
    }
    if (userIds.length) {
        await db.delete(users).where(inArray(users.id, userIds));
        userIds.length = 0;
    }
    if (departmentIds.length) {
        await db.delete(departments).where(inArray(departments.id, departmentIds));
        departmentIds.length = 0;
    }
}

const run = (over: Partial<Parameters<typeof transactionReport>[0]> = {}) =>
    transactionReport({ dateFrom: DAY, dateTo: DAY, page: 1, pageSize: 1000, ...over });

const idOf = (items: Awaited<ReturnType<typeof transactionReport>>["items"], suffix: string) =>
    items.find((i) => i.receipt_number === `R-${TAG}-${suffix}`)?.payer_id;

describe("transactionReport — ID column", () => {
    it.if(HAS_DB)(
        "shows a student's ISB ID, not their student_code or customer_code",
        async () => {
            if (!dbOk) return;
            try {
                // All three columns hold different values so the assertion can
                // only pass by reading the right one.
                const cid = await seedCustomer({ code: `PS-${TAG}-A`, studentCode: `SC-${TAG}`, externalId: `EXT-${TAG}-A` });
                await seedReceipt({ suffix: "A", total: 100, customerId: cid });

                const out = await run();
                expect(idOf(out.items, "A")).toBe(`EXT-${TAG}-A`);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "shows a staff/parent payer's ISB ID, not their username",
        async () => {
            if (!dbOk) return;
            // The row that made this worth changing: a username in a column
            // meant to reconcile against school records.
            try {
                const uid = await seedUser({ username: `${TAG}-user`, externalId: `EXT-${TAG}-B` });
                await seedReceipt({ suffix: "B", total: 200, payerUserId: uid });

                const out = await run();
                expect(idOf(out.items, "B")).toBe(`EXT-${TAG}-B`);
                expect(idOf(out.items, "B")).not.toBe(`${TAG}-user`);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "still shows the department code when a budget paid",
        async () => {
            if (!dbOk) return;
            // Departments have no external_id at all, so this is the one case
            // that must keep its old value.
            try {
                const did = await seedDepartment(`${TAG}-DEP`);
                await seedReceipt({ suffix: "C", total: 300, payerDepartmentId: did });

                const out = await run();
                expect(idOf(out.items, "C")).toBe(`${TAG}-DEP`);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "shows a dash rather than falling back to a local code",
        async () => {
            if (!dbOk) return;
            try {
                const cid = await seedCustomer({ code: `PS-${TAG}-D`, studentCode: `SC-${TAG}-D`, externalId: null });
                const uid = await seedUser({ username: `${TAG}-nox`, externalId: null });
                await seedReceipt({ suffix: "D", total: 400, customerId: cid });
                await seedReceipt({ suffix: "E", total: 500, payerUserId: uid });

                const out = await run();
                // Not "SC-…", not "PS-…", not the username — a fallback would
                // put a second format back in the column.
                expect(idOf(out.items, "D")).toBe("—");
                expect(idOf(out.items, "E")).toBe("—");
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "applies the same rule to non-sale rows",
        async () => {
            if (!dbOk) return;
            // Adjustments/top-ups/transfers come from a different query in the
            // same service. One column, one rule.
            try {
                const cid = await seedCustomer({ code: `PS-${TAG}-F`, studentCode: `SC-${TAG}-F`, externalId: `EXT-${TAG}-F` });
                const uid = await seedUser({ username: `${TAG}-adj`, externalId: `EXT-${TAG}-G` });
                await seedAdjustment(await seedWallet({ customerId: cid }), 50);
                await seedAdjustment(await seedWallet({ userId: uid }), 60);

                const out = await run({ type: "adjustment" });
                const ids = out.items.map((i) => i.payer_id).sort();
                expect(ids).toEqual([`EXT-${TAG}-F`, `EXT-${TAG}-G`]);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "keeps search working on both the ISB ID and the old local codes",
        async () => {
            if (!dbOk) return;
            // The column changed; the search box deliberately did not, so a
            // cashier who only knows a username can still find the row.
            try {
                const uid = await seedUser({ username: `${TAG}-find`, externalId: `EXT-${TAG}-H` });
                await seedReceipt({ suffix: "H", total: 600, payerUserId: uid });

                expect((await run({ search: `EXT-${TAG}-H` })).total).toBe(1);
                expect((await run({ search: `${TAG}-find` })).total).toBe(1);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "changes only the label — amounts and row counts are untouched",
        async () => {
            if (!dbOk) return;
            try {
                const cid = await seedCustomer({ code: `PS-${TAG}-I`, externalId: `EXT-${TAG}-I` });
                const did = await seedDepartment(`${TAG}-DEP2`);
                await seedReceipt({ suffix: "I", total: 111.25, customerId: cid });
                await seedReceipt({ suffix: "J", total: 222.5, payerDepartmentId: did });

                const out = await run({ type: "sale" });
                expect(out.total).toBe(2);
                expect(out.amount_total).toBeCloseTo(333.75, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );
});
