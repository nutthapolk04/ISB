/**
 * Sales Report total vs Daily Sales Report total.
 *
 * The two reports disagreed on canteen data because they were summing
 * different things:
 *
 *   Sales Report       SUM(receipt_items.line_total)
 *   Daily Sales Report SUM(receipts.total)  =  SUM(line_total) − discount + edc_card_fee
 *
 * so any bill-level discount made Sales Report read HIGH and any EDC card
 * surcharge made it read LOW. On real data (canteen, 2026-07-01 → 2026-08-07)
 * the whole ฿153.90 gap was five discounted receipts.
 *
 * `netTotals` applies the same two adjustments to Sales Report's total. It is
 * opt-in because Sales by Item Report shares this endpoint and must keep
 * reporting the raw line sum.
 *
 * The load-bearing cases are:
 *   - the adjustment is taken once per RECEIPT, not once per line (a 3-item
 *     basket must not have its discount subtracted three times);
 *   - voided receipts contribute neither line totals nor adjustments;
 *   - with netTotals on, the figure equals salesSummaryReport's amt_billing —
 *     that equality is the actual requirement, the rest is how it's reached.
 *
 * Conventions mirror stock_card_report.test.ts: localhost-only DB, run-unique
 * fixtures, FK-ordered cleanup in `finally`.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { inArray } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { receiptItems, receipts, shopProducts } from "@/db/schema";
import { salesByItemReport, salesSummaryReport } from "@/services/report_service";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";

const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
const DB_TIMEOUT_MS = 45_000;

const SHOP_ID = "S0001";
const TAG = `snt-${Date.now().toString(36)}`;
// A window of its own so other fixtures and real data can't leak into the
// totals being asserted.
const DAY = "2031-03-14";
const adminUser = { sub: "1", roles: ["admin"], shop_id: null } as unknown as AccessTokenPayload;

beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    }
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn(
            "[sales_report_net_totals] Skipping DB-backed cases: DATABASE_URL is not localhost. " +
            "These tests write fixture rows and must not run against a shared database.",
        );
    }
    if (HAS_DB) dbOk = await pingDb();
});

const productIds: number[] = [];
const receiptIds: number[] = [];

async function seedProduct(code: string): Promise<number> {
    const [p] = await db
        .insert(shopProducts)
        .values({
            shopId: SHOP_ID, productCode: code, name: `${code} fixture`, category: "TEST",
            externalPrice: "100.00", internalPrice: "100.00", avgCost: "60.0000",
            stock: 1000, isActive: true, vatPercent: "0", minStock: 0,
        })
        .returning({ id: shopProducts.id });
    productIds.push(p.id);
    return p.id;
}

/** One receipt whose `total` is derived the way checkout derives it, so the
 *  fixture can't accidentally encode the very mismatch under test. */
async function seedReceipt(opts: {
    suffix: string;
    lines: Array<{ productId: number; qty: number; unitPrice: number }>;
    discount?: number;
    edcCardFee?: number;
    status?: "ACTIVE" | "VOIDED";
    voidedAt?: string | null;
    time?: string;
}): Promise<number> {
    const subtotal = opts.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const discount = opts.discount ?? 0;
    const fee = opts.edcCardFee ?? 0;
    const total = Math.round((subtotal - discount + fee) * 100) / 100;

    const [r] = await db
        .insert(receipts)
        .values({
            receiptNumber: `R-${TAG}-${opts.suffix}`,
            transactionDate: `${DAY}T${opts.time ?? "10:00:00"}+07:00`,
            transactionMode: "SALE",
            shopId: SHOP_ID,
            subtotal: subtotal.toFixed(2),
            discount: discount.toFixed(2),
            tax: "0.00",
            total: total.toFixed(2),
            edcCardFee: fee.toFixed(2),
            paymentMethod: fee > 0 ? "EDC" : "CASH",
            status: opts.status ?? "ACTIVE",
            voidedAt: opts.voidedAt ?? null,
            createdBy: 1,
        })
        .returning({ id: receipts.id });
    receiptIds.push(r.id);

    for (const l of opts.lines) {
        await db.insert(receiptItems).values({
            receiptId: r.id,
            productVariantId: l.productId,
            quantity: l.qty,
            unitPrice: l.unitPrice.toFixed(2),
            discount: "0.00",
            lineTotal: (l.qty * l.unitPrice).toFixed(2),
        });
    }
    return r.id;
}

async function cleanup(): Promise<void> {
    if (receiptIds.length) {
        await db.delete(receiptItems).where(inArray(receiptItems.receiptId, receiptIds));
        await db.delete(receipts).where(inArray(receipts.id, receiptIds));
        receiptIds.length = 0;
    }
    if (productIds.length) {
        await db.delete(shopProducts).where(inArray(shopProducts.id, productIds));
        productIds.length = 0;
    }
}

const report = (netTotals: boolean) =>
    salesByItemReport({ user: adminUser, dateFrom: DAY, dateTo: DAY, shopId: SHOP_ID, netTotals });

describe("salesByItemReport — netTotals", () => {
    it.if(HAS_DB)(
        "leaves the total as the raw line sum when netTotals is off",
        async () => {
            if (!dbOk) return;
            try {
                // Sales by Item Report shares this endpoint and must not move.
                const pid = await seedProduct(`${TAG}-A`);
                await seedReceipt({ suffix: "A1", lines: [{ productId: pid, qty: 2, unitPrice: 50 }], discount: 15.5 });

                const out = await report(false);
                expect(out.totals.sales_amt).toBeCloseTo(100, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "subtracts the bill-level discount when netTotals is on",
        async () => {
            if (!dbOk) return;
            try {
                const pid = await seedProduct(`${TAG}-B`);
                await seedReceipt({ suffix: "B1", lines: [{ productId: pid, qty: 2, unitPrice: 50 }], discount: 15.5 });

                const out = await report(true);
                expect(out.totals.sales_amt).toBeCloseTo(84.5, 2); // 100 − 15.50
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "adds the EDC card surcharge when netTotals is on",
        async () => {
            if (!dbOk) return;
            try {
                const pid = await seedProduct(`${TAG}-C`);
                await seedReceipt({ suffix: "C1", lines: [{ productId: pid, qty: 1, unitPrice: 200 }], edcCardFee: 6 });

                const out = await report(true);
                expect(out.totals.sales_amt).toBeCloseTo(206, 2); // 200 + 3%
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "takes the discount once per receipt, not once per line",
        async () => {
            if (!dbOk) return;
            // The receipt is joined once per line item, so a naive per-row
            // accumulation would subtract 30 from a 3-line basket instead of 10
            // — the single most likely way to get this wrong.
            try {
                const pid = await seedProduct(`${TAG}-D`);
                await seedReceipt({
                    suffix: "D1",
                    lines: [
                        { productId: pid, qty: 1, unitPrice: 40 },
                        { productId: pid, qty: 2, unitPrice: 30 },
                        { productId: pid, qty: 1, unitPrice: 50 },
                    ],
                    discount: 10,
                });

                const out = await report(true);
                expect(out.totals.sales_amt).toBeCloseTo(140, 2); // 150 − 10, not 150 − 30
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "ignores a voided receipt's discount and fee, as it ignores its lines",
        async () => {
            if (!dbOk) return;
            try {
                const pid = await seedProduct(`${TAG}-E`);
                await seedReceipt({ suffix: "E1", lines: [{ productId: pid, qty: 1, unitPrice: 100 }] });
                await seedReceipt({
                    suffix: "E2",
                    lines: [{ productId: pid, qty: 1, unitPrice: 500 }],
                    discount: 50,
                    status: "VOIDED",
                    voidedAt: `${DAY}T11:00:00+07:00`,
                });

                const out = await report(true);
                // Only the live receipt counts. Folding the voided receipt's
                // discount in would push this to 50 and make the report show
                // less than was actually sold.
                expect(out.totals.sales_amt).toBeCloseTo(100, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "matches Daily Sales Report's Amt Billing over the same window",
        async () => {
            if (!dbOk) return;
            // The requirement itself: a mixed day — plain sale, discounted
            // sale, card sale with surcharge, and a same-day void — has to
            // produce one number in both reports.
            try {
                const pid = await seedProduct(`${TAG}-F`);
                await seedReceipt({ suffix: "F1", lines: [{ productId: pid, qty: 3, unitPrice: 25 }], time: "09:00:00" });
                await seedReceipt({ suffix: "F2", lines: [{ productId: pid, qty: 2, unitPrice: 60 }], discount: 12.75, time: "10:00:00" });
                await seedReceipt({ suffix: "F3", lines: [{ productId: pid, qty: 1, unitPrice: 310 }], edcCardFee: 9.3, time: "11:00:00" });
                await seedReceipt({
                    suffix: "F4",
                    lines: [{ productId: pid, qty: 4, unitPrice: 15 }],
                    status: "VOIDED",
                    voidedAt: `${DAY}T13:00:00+07:00`,
                    time: "12:00:00",
                });

                const byItem = await report(true);
                const summary = await salesSummaryReport({
                    user: adminUser, dateFrom: DAY, dateTo: DAY, shopId: SHOP_ID,
                });

                // 75 + (120 − 12.75) + (310 + 9.30) = 501.55, void nets to zero.
                expect(byItem.totals.sales_amt).toBeCloseTo(501.55, 2);
                expect(byItem.totals.sales_amt).toBeCloseTo(summary.totals.amt_billing, 2);

                // And without the flag they still disagree — proving the flag
                // is what closes the gap rather than the fixture being trivial.
                const raw = await report(false);
                expect(raw.totals.sales_amt).not.toBeCloseTo(summary.totals.amt_billing, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "leaves rows and line_count untouched — only the total moves",
        async () => {
            if (!dbOk) return;
            try {
                const pid = await seedProduct(`${TAG}-G`);
                await seedReceipt({ suffix: "G1", lines: [{ productId: pid, qty: 2, unitPrice: 50 }], discount: 20 });

                const off = await report(false);
                const on = await report(true);

                expect(on.rows).toEqual(off.rows);
                expect(on.line_count).toBe(off.line_count);
                expect(on.totals.sales_qty).toBe(off.totals.sales_qty);
                expect(on.totals.sales_amt).not.toBeCloseTo(off.totals.sales_amt, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );
});
