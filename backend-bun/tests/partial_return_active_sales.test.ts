/**
 * Partial return / exchange must be netted out of ACTIVE sales totals.
 *
 * `returns_service.ts::processRefund()` and `processExchange()` insert a row
 * into `return_requests` (refund_amount = the value returned) but never touch
 * the original `receipts` row — its `total` and `status` stay exactly as they
 * were at checkout, kept as an audit trail of the sale as it happened. A
 * full void, by contrast, flips `receipts.status` to 'VOIDED' and is already
 * excluded correctly everywhere.
 *
 * Two ACTIVE-sales aggregates never accounted for the return_requests side of
 * that story and so kept counting the full original total even after part of
 * the receipt was returned:
 *   - canteen_service.ts::closeDay()          → the "Today Sale" button
 *   - pos_service.ts::aggregateActiveSales()  → Receipts page stats
 *     (today_active_sales / month_active_sales / filtered_active_sales)
 *
 * Both now LEFT JOIN a per-receipt SUM of `return_requests.refund_amount`
 * where status = 'approved' (refund and exchange both land here — both mean
 * "this much was taken back out of the original receipt") and subtract it
 * from `receipts.total` at query time, keyed by the original sale's own
 * transaction_date — never mutating the receipt itself.
 *
 * Conventions mirror sales_report_net_totals.test.ts / transaction_report_
 * reconcile.test.ts — localhost-only DB, run-unique fixtures, FK-ordered
 * cleanup in `finally`. closeDay() has no date-override parameter (it always
 * computes "today" in Asia/Bangkok), so its fixtures use a dedicated,
 * never-reused shop_id and today's real Bangkok date instead of a fixed
 * historical day — isolation comes from the shop, not the date.
 */
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { inArray } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { receipts, returnRequests, shops, users } from "@/db/schema";
import { closeDay } from "@/services/canteen_service";
import { listReceipts } from "@/services/pos_service";
import { bangkokTodayIso } from "@/lib/dates";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";

const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
const DB_TIMEOUT_MS = 45_000;

const TAG = `par${Date.now().toString(36)}`;
// closeDay() always reads real "today" in Bangkok, so isolation for it has to
// come from a shop nothing else writes to, not from a historical date.
const CD_SHOP_ID = `cd-${TAG}`;
// listReceipts()'s filtered_active_sales accepts an explicit date range, so
// this one can use a fixed, far-from-real-traffic day instead.
const RC_SHOP_ID = `rc-${TAG}`;
const FIXED_DAY = "2032-09-21";
const adminUser = { sub: "1", roles: ["admin"], shop_id: null } as unknown as AccessTokenPayload;
// closeDay() now requires a caller (admin/manager see the full per-cashier
// breakdown; these pre-existing tests only assert the shop-wide totals, so
// an admin caller keeps their behavior unchanged).
const ADMIN_CALLER = { id: 1, roles: ["admin"] as AccessTokenPayload["roles"] };

let cashierUserId = 0;
const receiptIds: number[] = [];
const returnIds: number[] = [];

beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    }
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn(
            "[partial_return_active_sales] Skipping DB-backed cases: DATABASE_URL is not localhost. " +
            "These tests write fixture rows and must not run against a shared database.",
        );
    }
    if (HAS_DB) {
        dbOk = await pingDb();
        if (dbOk) {
            const rows = await db.select({ id: users.id }).from(users).limit(1);
            if (!rows[0]) throw new Error("No users row — seed DB before running this test");
            cashierUserId = rows[0].id;
            await db.insert(shops).values([
                { id: CD_SHOP_ID, name: `Partial return fixture ${TAG} (close-day)`, shopType: "avg_cost", isActive: true },
                { id: RC_SHOP_ID, name: `Partial return fixture ${TAG} (receipts)`, shopType: "avg_cost", isActive: true },
            ]);
        }
    }
});

afterAll(async () => {
    if (!dbOk) return;
    await db.delete(shops).where(inArray(shops.id, [CD_SHOP_ID, RC_SHOP_ID]));
});

async function seedReceipt(opts: {
    shopId: string;
    suffix: string;
    total: number;
    status?: "ACTIVE" | "VOIDED";
    /** Bangkok calendar date; defaults to today (needed for closeDay fixtures). */
    day?: string;
}): Promise<{ id: number; receiptNumber: string }> {
    const day = opts.day ?? bangkokTodayIso();
    const receiptNumber = `R-${TAG}-${opts.suffix}`;
    const [r] = await db
        .insert(receipts)
        .values({
            receiptNumber,
            transactionDate: `${day}T10:00:00+07:00`,
            transactionMode: "SALE",
            shopId: opts.shopId,
            subtotal: opts.total.toFixed(2),
            discount: "0.00",
            tax: "0.00",
            total: opts.total.toFixed(2),
            paymentMethod: "CASH",
            status: opts.status ?? "ACTIVE",
            createdBy: cashierUserId,
        })
        .returning({ id: receipts.id });
    receiptIds.push(r.id);
    return { id: r.id, receiptNumber };
}

async function seedReturn(opts: {
    receiptNumber: string;
    refundAmount: number;
    suffix: string;
    status?: "pending" | "approved" | "rejected";
}): Promise<void> {
    const [rr] = await db
        .insert(returnRequests)
        .values({
            receiptId: opts.receiptNumber,
            productCode: `RP-${TAG}-${opts.suffix}`,
            productName: `Return fixture ${opts.suffix}`,
            quantity: 1,
            returnQuantity: 1,
            price: opts.refundAmount.toFixed(2),
            reason: "test return",
            status: opts.status ?? "approved",
            refundAmount: opts.refundAmount.toFixed(2),
            createdBy: cashierUserId,
        })
        .returning({ id: returnRequests.id });
    returnIds.push(rr.id);
}

async function cleanup(): Promise<void> {
    if (returnIds.length) {
        await db.delete(returnRequests).where(inArray(returnRequests.id, returnIds));
        returnIds.length = 0;
    }
    if (receiptIds.length) {
        await db.delete(receipts).where(inArray(receipts.id, receiptIds));
        receiptIds.length = 0;
    }
}

describe("canteen_service.closeDay() — nets out approved returns", () => {
    it.if(HAS_DB)(
        "regression: an untouched receipt still reports its full total",
        async () => {
            if (!dbOk) return;
            try {
                await seedReceipt({ shopId: CD_SHOP_ID, suffix: "CDA", total: 100 });
                const summary = await closeDay(CD_SHOP_ID, ADMIN_CALLER);
                expect(summary.total_orders).toBe(1);
                expect(summary.total_revenue).toBeCloseTo(100, 2);
                expect(summary.payment_breakdown.CASH).toBeCloseTo(100, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "a fully-voided receipt is still excluded entirely",
        async () => {
            if (!dbOk) return;
            try {
                await seedReceipt({ shopId: CD_SHOP_ID, suffix: "CDB", total: 200, status: "VOIDED" });
                const summary = await closeDay(CD_SHOP_ID, ADMIN_CALLER);
                expect(summary.total_orders).toBe(0);
                expect(summary.total_revenue).toBe(0);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "a partial return nets the refund out of the sale (the bug being fixed)",
        async () => {
            if (!dbOk) return;
            try {
                const r = await seedReceipt({ shopId: CD_SHOP_ID, suffix: "CDC", total: 150 });
                await seedReturn({ receiptNumber: r.receiptNumber, refundAmount: 40, suffix: "C1" });
                const summary = await closeDay(CD_SHOP_ID, ADMIN_CALLER);
                expect(summary.total_orders).toBe(1);
                expect(summary.total_revenue).toBeCloseTo(110, 2); // 150 - 40
                expect(summary.payment_breakdown.CASH).toBeCloseTo(110, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "two approved returns on the same receipt accumulate",
        async () => {
            if (!dbOk) return;
            try {
                const r = await seedReceipt({ shopId: CD_SHOP_ID, suffix: "CDD", total: 300 });
                await seedReturn({ receiptNumber: r.receiptNumber, refundAmount: 50, suffix: "D1" });
                await seedReturn({ receiptNumber: r.receiptNumber, refundAmount: 30, suffix: "D2" });
                const summary = await closeDay(CD_SHOP_ID, ADMIN_CALLER);
                expect(summary.total_revenue).toBeCloseTo(220, 2); // 300 - 50 - 30
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "pending and rejected returns are not deducted",
        async () => {
            if (!dbOk) return;
            try {
                const r = await seedReceipt({ shopId: CD_SHOP_ID, suffix: "CDE", total: 90 });
                await seedReturn({ receiptNumber: r.receiptNumber, refundAmount: 20, status: "pending", suffix: "E1" });
                await seedReturn({ receiptNumber: r.receiptNumber, refundAmount: 15, status: "rejected", suffix: "E2" });
                const summary = await closeDay(CD_SHOP_ID, ADMIN_CALLER);
                expect(summary.total_revenue).toBeCloseTo(90, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );
});

async function filteredActiveSales(shopId: string, day: string): Promise<number> {
    const res = await listReceipts({
        caller: adminUser,
        shopId,
        dateFrom: day,
        dateTo: day,
        includeStats: true,
        page: 1,
        pageSize: 10,
    });
    return res.stats!.filtered_active_sales;
}

describe("pos_service.listReceipts() stats — nets out approved returns", () => {
    it.if(HAS_DB)(
        "regression: an untouched receipt still reports its full total",
        async () => {
            if (!dbOk) return;
            try {
                await seedReceipt({ shopId: RC_SHOP_ID, suffix: "RCA", total: 120, day: FIXED_DAY });
                const sales = await filteredActiveSales(RC_SHOP_ID, FIXED_DAY);
                expect(sales).toBeCloseTo(120, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "a fully-voided receipt is still excluded entirely",
        async () => {
            if (!dbOk) return;
            try {
                await seedReceipt({ shopId: RC_SHOP_ID, suffix: "RCB", total: 250, status: "VOIDED", day: FIXED_DAY });
                const sales = await filteredActiveSales(RC_SHOP_ID, FIXED_DAY);
                expect(sales).toBe(0);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "a partial return nets the refund out of the sale (the bug being fixed)",
        async () => {
            if (!dbOk) return;
            try {
                const r = await seedReceipt({ shopId: RC_SHOP_ID, suffix: "RCC", total: 180, day: FIXED_DAY });
                await seedReturn({ receiptNumber: r.receiptNumber, refundAmount: 65, suffix: "RC1" });
                const sales = await filteredActiveSales(RC_SHOP_ID, FIXED_DAY);
                expect(sales).toBeCloseTo(115, 2); // 180 - 65
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "two approved returns on the same receipt accumulate",
        async () => {
            if (!dbOk) return;
            try {
                const r = await seedReceipt({ shopId: RC_SHOP_ID, suffix: "RCD", total: 400, day: FIXED_DAY });
                await seedReturn({ receiptNumber: r.receiptNumber, refundAmount: 70, suffix: "RD1" });
                await seedReturn({ receiptNumber: r.receiptNumber, refundAmount: 25, suffix: "RD2" });
                const sales = await filteredActiveSales(RC_SHOP_ID, FIXED_DAY);
                expect(sales).toBeCloseTo(305, 2); // 400 - 70 - 25
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "pending and rejected returns are not deducted",
        async () => {
            if (!dbOk) return;
            try {
                const r = await seedReceipt({ shopId: RC_SHOP_ID, suffix: "RCE", total: 60, day: FIXED_DAY });
                await seedReturn({ receiptNumber: r.receiptNumber, refundAmount: 10, status: "pending", suffix: "RE1" });
                await seedReturn({ receiptNumber: r.receiptNumber, refundAmount: 8, status: "rejected", suffix: "RE2" });
                const sales = await filteredActiveSales(RC_SHOP_ID, FIXED_DAY);
                expect(sales).toBeCloseTo(60, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );
});
