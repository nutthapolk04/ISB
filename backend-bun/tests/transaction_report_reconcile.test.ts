/**
 * Transaction Report — every Type must reconcile against its own report.
 *
 * The report is an activity log across four kinds of money movement, and each
 * kind already has a dedicated report. If they disagree, one of them is lying
 * and nobody can tell which. Four things had to change before they could agree:
 *
 *   sale        a voided receipt was ONE negative row dated by the sale, and the
 *               printed total quietly excluded it — so the Amount column never
 *               added up to the figure at the bottom. It's now a sale leg plus
 *               a reversal dated when the void happened, both counted, exactly
 *               like salesSummaryReport().
 *   adjustment  amounts ran through Math.abs(), so an undo that took ฿1,100 off
 *               a wallet ADDED ฿1,100 — ฿2,200 of phantom money on this data.
 *   transfer    both legs of a transfer were listed and both counted positive,
 *               reading ฿19,600 of movement as ฿39,200.
 *   totals      `type=sale` used one formula and every other view used another,
 *               so changing the filter changed what "Total" meant.
 *
 * The load-bearing assertion in most cases below is `column === amount_total`:
 * once the total is simply the column added up, a whole class of "the export
 * doesn't foot" bugs can't come back.
 *
 * Conventions mirror transaction_report_payer_id.test.ts — localhost-only DB,
 * run-unique fixtures, FK-ordered cleanup in `finally`.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { inArray } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import {
    customers,
    customerTypes,
    receipts,
    users,
    walletTransactions,
    wallets,
} from "@/db/schema";
import {
    adjustmentReport,
    transactionReport,
    transferReport,
    topupReport,
} from "@/services/admin_reports_service";
import { salesSummaryReport } from "@/services/report_service";
import { resolvePageSize, EXPORT_ROW_CEILING } from "@/controllers/AdminReportsController";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";

const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
const DB_TIMEOUT_MS = 45_000;

const SHOP_ID = "S0001";
const TAG = `txr-${Date.now().toString(36)}`;
const DAY = "2033-06-15";
const PRIOR_DAY = "2033-06-12";
const adminUser = { sub: "1", roles: ["admin"], shop_id: null } as unknown as AccessTokenPayload;

beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn(
            "[transaction_report_reconcile] Skipping DB-backed cases: DATABASE_URL is not localhost. " +
            "These tests write fixture rows and must not run against a shared database.",
        );
    }
    if (HAS_DB) dbOk = await pingDb();
});

// ── Pure: export page-size resolution ─────────────────────────────────────

describe("resolvePageSize", () => {
    const opts = { cap: 5000, fallback: 50 };

    it("returns the whole set for page_size=all when a date range is given", () => {
        const out = resolvePageSize({ page_size: "all", date_from: "2026-01-01", date_to: "2026-01-31" }, opts);
        expect(out).toEqual({ pageSize: EXPORT_ROW_CEILING, unlimited: true });
    });

    it("refuses page_size=all without a date range", () => {
        // "Everything, unbounded" means the school's entire history.
        expect(resolvePageSize({ page_size: "all" }, opts)).toHaveProperty("error");
        expect(resolvePageSize({ page_size: "all", date_from: "2026-01-01" }, opts)).toHaveProperty("error");
        expect(resolvePageSize({ page_size: "all", date_to: "2026-01-31" }, opts)).toHaveProperty("error");
    });

    it("still clamps an explicit page size and defaults when absent", () => {
        expect(resolvePageSize({ page_size: "20" }, opts)).toEqual({ pageSize: 20, unlimited: false });
        expect(resolvePageSize({ page_size: "999999" }, opts)).toEqual({ pageSize: 5000, unlimited: false });
        expect(resolvePageSize({}, opts)).toEqual({ pageSize: 50, unlimited: false });
    });
});

// ── DB-backed ─────────────────────────────────────────────────────────────

const customerIds: number[] = [];
const userIds: number[] = [];
const walletIds: number[] = [];
const receiptIds: number[] = [];
const walletTxIds: number[] = [];

async function seedCustomer(code: string): Promise<number> {
    const [ct] = await db.select({ id: customerTypes.id }).from(customerTypes).limit(1);
    if (!ct) throw new Error("No customer_types row — seed the DB first");
    const [c] = await db.insert(customers).values({
        customerCode: code, name: `${code} fixture`, customerTypeId: ct.id,
        externalId: code, isActive: true, cardFrozen: false, customerKind: "student",
    }).returning({ id: customers.id });
    customerIds.push(c.id);
    return c.id;
}

async function seedUser(username: string): Promise<number> {
    const [u] = await db.insert(users).values({
        username, email: `${username}@fixture.invalid`, fullName: `${username} fixture`,
        hashedPassword: "x", isActive: true, isSuperuser: false, role: "parent", externalId: username,
    }).returning({ id: users.id });
    userIds.push(u.id);
    return u.id;
}

async function seedWallet(owner: { customerId?: number; userId?: number }): Promise<number> {
    const [w] = await db.insert(wallets).values({
        customerId: owner.customerId ?? null, userId: owner.userId ?? null,
        balance: "0", isActive: true,
    }).returning({ id: wallets.id });
    walletIds.push(w.id);
    return w.id;
}

async function seedReceipt(o: {
    suffix: string; total: number; customerId: number;
    status?: "ACTIVE" | "VOIDED"; voidedAt?: string | null; day?: string; time?: string;
}): Promise<void> {
    const [r] = await db.insert(receipts).values({
        receiptNumber: `R-${TAG}-${o.suffix}`,
        transactionDate: `${o.day ?? DAY}T${o.time ?? "10:00:00"}+07:00`,
        transactionMode: "SALE", shopId: SHOP_ID,
        subtotal: o.total.toFixed(2), discount: "0.00", tax: "0.00", total: o.total.toFixed(2),
        paymentMethod: "CASH", status: o.status ?? "ACTIVE",
        customerId: o.customerId, voidedAt: o.voidedAt ?? null, createdBy: 1,
    }).returning({ id: receipts.id });
    receiptIds.push(r.id);
}

async function seedWalletTx(o: {
    walletId: number; type: "ADJUSTMENT" | "TOPUP" | "DEDUCTION";
    referenceType: string; amount: number; before: number; after: number;
    reason?: string | null; referenceId?: number | null; time?: string;
}): Promise<void> {
    const [t] = await db.insert(walletTransactions).values({
        walletId: o.walletId, transactionType: o.type, amount: Math.abs(o.amount).toFixed(2),
        balanceBefore: o.before.toFixed(2), balanceAfter: o.after.toFixed(2),
        referenceType: o.referenceType, referenceId: o.referenceId ?? null,
        reason: o.reason ?? null, description: `${TAG} fixture`,
        createdAt: `${DAY}T${o.time ?? "11:00:00"}+07:00`, createdBy: 1,
    }).returning({ id: walletTransactions.id });
    walletTxIds.push(t.id);
}

async function cleanup(): Promise<void> {
    if (walletTxIds.length) { await db.delete(walletTransactions).where(inArray(walletTransactions.id, walletTxIds)); walletTxIds.length = 0; }
    if (receiptIds.length) { await db.delete(receipts).where(inArray(receipts.id, receiptIds)); receiptIds.length = 0; }
    if (walletIds.length) { await db.delete(wallets).where(inArray(wallets.id, walletIds)); walletIds.length = 0; }
    if (customerIds.length) { await db.delete(customers).where(inArray(customers.id, customerIds)); customerIds.length = 0; }
    if (userIds.length) { await db.delete(users).where(inArray(users.id, userIds)); userIds.length = 0; }
}

const run = (over: Partial<Parameters<typeof transactionReport>[0]> = {}) =>
    transactionReport({ dateFrom: DAY, dateTo: DAY, page: 1, pageSize: 5000, ...over });

/** The property that keeps exports honest. */
const columnSum = (r: Awaited<ReturnType<typeof transactionReport>>) =>
    Math.round(r.items.reduce((s, i) => s + i.amount, 0) * 100) / 100;

describe("transactionReport — legs, signs and totals", () => {
    it.if(HAS_DB)(
        "shows a voided sale as two legs and still foots to the printed total",
        async () => {
            if (!dbOk) return;
            try {
                const cid = await seedCustomer(`${TAG}-A`);
                await seedReceipt({ suffix: "A1", total: 100, customerId: cid, time: "09:00:00" });
                await seedReceipt({
                    suffix: "A2", total: 60, customerId: cid, time: "10:00:00",
                    status: "VOIDED", voidedAt: `${DAY}T12:00:00+07:00`,
                });

                const out = await run({ type: "sale" });
                const legs = out.items.filter((i) => i.receipt_number === `R-${TAG}-A2`);
                expect(legs).toHaveLength(2);
                expect(legs.find((l) => l.status === "ACTIVE")!.amount).toBeCloseTo(60, 2);
                expect(legs.find((l) => l.status === "VOIDED")!.amount).toBeCloseTo(-60, 2);

                expect(out.amount_total).toBeCloseTo(100, 2);   // the void cancels itself
                expect(columnSum(out)).toBeCloseTo(out.amount_total, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "carries the reversal of a receipt sold before the window",
        async () => {
            if (!dbOk) return;
            try {
                const cid = await seedCustomer(`${TAG}-B`);
                await seedReceipt({ suffix: "B1", total: 200, customerId: cid, time: "09:00:00" });
                await seedReceipt({
                    suffix: "B2", total: 72, customerId: cid, day: PRIOR_DAY,
                    status: "VOIDED", voidedAt: `${DAY}T10:49:00+07:00`,
                });

                const out = await run({ type: "sale" });
                const legs = out.items.filter((i) => i.receipt_number === `R-${TAG}-B2`);
                expect(legs).toHaveLength(1);                 // reversal only
                expect(legs[0].status).toBe("VOIDED");
                expect(legs[0].amount).toBeCloseTo(-72, 2);
                expect(out.amount_total).toBeCloseTo(128, 2); // 200 − 72
                expect(columnSum(out)).toBeCloseTo(out.amount_total, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "filters status per leg, not per receipt",
        async () => {
            if (!dbOk) return;
            // A receipt voided later still made a sale on the day it was rung
            // up; filtering it out of the ACTIVE view would hide that sale.
            try {
                const cid = await seedCustomer(`${TAG}-C`);
                await seedReceipt({
                    suffix: "C1", total: 90, customerId: cid,
                    status: "VOIDED", voidedAt: `${DAY}T15:00:00+07:00`,
                });

                const active = await run({ type: "sale", status: "ACTIVE" });
                const voided = await run({ type: "sale", status: "VOIDED" });
                expect(active.items).toHaveLength(1);
                expect(active.items[0].amount).toBeCloseTo(90, 2);
                expect(voided.items).toHaveLength(1);
                expect(voided.items[0].amount).toBeCloseTo(-90, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "signs an adjustment by what happened to the balance",
        async () => {
            if (!dbOk) return;
            try {
                const uid = await seedUser(`${TAG}-adj`);
                const wid = await seedWallet({ userId: uid });
                await seedWalletTx({ walletId: wid, type: "ADJUSTMENT", referenceType: "admin_adjustment", amount: 300, before: 0, after: 300 });
                // An undo taking the money back off. Math.abs() used to make
                // this ADD 200 instead of removing it.
                await seedWalletTx({ walletId: wid, type: "DEDUCTION", referenceType: "admin_adjustment", amount: 200, before: 300, after: 100, time: "12:00:00" });

                const out = await run({ type: "adjustment" });
                const amounts = out.items.map((i) => i.amount).sort((a, b) => a - b);
                expect(amounts).toEqual([-200, 300]);
                expect(out.amount_total).toBeCloseTo(100, 2);
                expect(columnSum(out)).toBeCloseTo(out.amount_total, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "counts a transfer once and names both sides",
        async () => {
            if (!dbOk) return;
            try {
                const senderId = await seedUser(`${TAG}-from`);
                const recvId = await seedCustomer(`${TAG}-to`);
                const fromW = await seedWallet({ userId: senderId });
                const toW = await seedWallet({ customerId: recvId });
                // Both legs exist in the data, as transferWithinFamily writes them.
                await seedWalletTx({ walletId: fromW, type: "DEDUCTION", referenceType: "family_transfer", amount: 500, before: 500, after: 0, referenceId: toW });
                await seedWalletTx({ walletId: toW, type: "TOPUP", referenceType: "family_transfer", amount: 500, before: 0, after: 500, referenceId: fromW });

                const out = await run({ type: "transfer" });
                expect(out.items).toHaveLength(1);            // not two
                expect(out.items[0].amount).toBeCloseTo(500, 2);
                expect(out.items[0].payer_name).toBe(`${TAG}-from fixture → ${TAG}-to fixture`);
                expect(out.amount_total).toBeCloseTo(500, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "uses one totals rule for every Type filter",
        async () => {
            if (!dbOk) return;
            // The total used to switch formulas on `type=sale`, so the same
            // rows added up to two different numbers depending on the filter.
            try {
                const cid = await seedCustomer(`${TAG}-D`);
                const wid = await seedWallet({ customerId: cid });
                await seedReceipt({ suffix: "D1", total: 100, customerId: cid });
                await seedReceipt({ suffix: "D2", total: 40, customerId: cid, status: "VOIDED", voidedAt: `${DAY}T13:00:00+07:00` });
                await seedWalletTx({ walletId: wid, type: "ADJUSTMENT", referenceType: "admin_adjustment", amount: 25, before: 0, after: 25 });

                for (const type of [undefined, "sale", "adjustment"]) {
                    const out = await run(type ? { type } : {});
                    expect(columnSum(out)).toBeCloseTo(out.amount_total, 2);
                }
                const all = await run();
                expect(all.amount_total).toBeCloseTo(125, 2); // 100 + (40 − 40) + 25
                expect(all.totals_by_kind.find((k) => k.kind === "sale")!.amount).toBeCloseTo(100, 2);
                expect(all.totals_by_kind.find((k) => k.kind === "adjustment")!.amount).toBeCloseTo(25, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );
});

describe("each Type reconciles against its own report", () => {
    it.if(HAS_DB)(
        "sale ↔ Daily Sales Report",
        async () => {
            if (!dbOk) return;
            try {
                const cid = await seedCustomer(`${TAG}-E`);
                await seedReceipt({ suffix: "E1", total: 150, customerId: cid, time: "09:00:00" });
                await seedReceipt({ suffix: "E2", total: 80, customerId: cid, time: "10:00:00", status: "VOIDED", voidedAt: `${DAY}T14:00:00+07:00` });
                await seedReceipt({ suffix: "E3", total: 72, customerId: cid, day: PRIOR_DAY, status: "VOIDED", voidedAt: `${DAY}T15:00:00+07:00` });

                const txn = await run({ type: "sale", shopId: SHOP_ID });
                const daily = await salesSummaryReport({ user: adminUser, dateFrom: DAY, dateTo: DAY, shopId: SHOP_ID });
                expect(txn.amount_total).toBeCloseTo(daily.totals.amt_billing, 2);
                expect(txn.total).toBe(daily.rows.length);   // leg for leg
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "transfer ↔ Wallet Transfer Report, adjustment ↔ Wallet Adjustment Report",
        async () => {
            if (!dbOk) return;
            try {
                const uid = await seedUser(`${TAG}-f1`);
                const cid = await seedCustomer(`${TAG}-f2`);
                const fromW = await seedWallet({ userId: uid });
                const toW = await seedWallet({ customerId: cid });
                await seedWalletTx({ walletId: fromW, type: "DEDUCTION", referenceType: "family_transfer", amount: 700, before: 700, after: 0, referenceId: toW });
                await seedWalletTx({ walletId: toW, type: "TOPUP", referenceType: "family_transfer", amount: 700, before: 0, after: 700, referenceId: fromW });
                await seedWalletTx({ walletId: fromW, type: "ADJUSTMENT", referenceType: "admin_adjustment", amount: 90, before: 0, after: 90, time: "12:00:00" });
                await seedWalletTx({ walletId: fromW, type: "DEDUCTION", referenceType: "admin_adjustment", amount: 30, before: 90, after: 60, time: "13:00:00" });

                const P = { dateFrom: DAY, dateTo: DAY, page: 1, pageSize: 5000 };
                const trf = await transferReport(P);
                const txnTrf = await run({ type: "transfer" });
                expect(txnTrf.amount_total).toBeCloseTo(trf.items.reduce((s, r) => s + r.amount, 0), 2);
                expect(txnTrf.total).toBe(trf.items.length);

                const adj = await adjustmentReport(P);
                // Adjustment Report keeps `amount` unsigned with a separate
                // direction, so its net is credits minus debits.
                const adjNet = adj.items.reduce((s, r) => s + (r.direction === "debit" ? -r.amount : r.amount), 0);
                const txnAdj = await run({ type: "adjustment" });
                expect(txnAdj.amount_total).toBeCloseTo(adjNet, 2);
                expect(txnAdj.total).toBe(adj.items.length);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "topup ↔ Top-up Report",
        async () => {
            if (!dbOk) return;
            try {
                const cid = await seedCustomer(`${TAG}-G`);
                const wid = await seedWallet({ customerId: cid });
                await seedWalletTx({
                    walletId: wid, type: "ADJUSTMENT", referenceType: "admin_adjustment",
                    amount: 400, before: 0, after: 400, reason: "Cash top-up at POS",
                });

                const P = { dateFrom: DAY, dateTo: DAY, page: 1, pageSize: 5000 };
                const top = await topupReport(P);
                const txn = await run({ type: "topup" });
                expect(txn.amount_total).toBeCloseTo(top.items.reduce((s, r) => s + r.amount, 0), 2);
                expect(txn.total).toBe(top.items.length);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );
});

describe("adjustmentReport", () => {
    it.if(HAS_DB)(
        "shows the reversal of an adjustment, not just the original",
        async () => {
            if (!dbOk) return;
            // It filtered to transaction_type='ADJUSTMENT', so an undo written
            // as TOPUP/DEDUCTION vanished from this report while the
            // Transaction Report still listed it — the two could never agree.
            try {
                const uid = await seedUser(`${TAG}-rev`);
                const wid = await seedWallet({ userId: uid });
                await seedWalletTx({ walletId: wid, type: "ADJUSTMENT", referenceType: "admin_adjustment", amount: 500, before: 0, after: 500 });
                await seedWalletTx({ walletId: wid, type: "DEDUCTION", referenceType: "admin_adjustment", amount: 500, before: 500, after: 0, time: "12:00:00" });

                const out = await adjustmentReport({ dateFrom: DAY, dateTo: DAY, page: 1, pageSize: 5000 });
                expect(out.items).toHaveLength(2);
                expect(out.items.map((r) => r.direction).sort()).toEqual(["credit", "debit"]);
                const net = out.items.reduce((s, r) => s + (r.direction === "debit" ? -r.amount : r.amount), 0);
                expect(net).toBeCloseTo(0, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "still keeps cash top-ups out — those belong to the Top-up Report",
        async () => {
            if (!dbOk) return;
            try {
                const cid = await seedCustomer(`${TAG}-H`);
                const wid = await seedWallet({ customerId: cid });
                await seedWalletTx({ walletId: wid, type: "ADJUSTMENT", referenceType: "admin_adjustment", amount: 75, before: 0, after: 75 });
                await seedWalletTx({
                    walletId: wid, type: "ADJUSTMENT", referenceType: "admin_adjustment",
                    amount: 400, before: 75, after: 475, reason: "Cash top-up at POS", time: "12:00:00",
                });

                const out = await adjustmentReport({ dateFrom: DAY, dateTo: DAY, page: 1, pageSize: 5000 });
                expect(out.items).toHaveLength(1);
                expect(out.items[0].amount).toBeCloseTo(75, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );
});
