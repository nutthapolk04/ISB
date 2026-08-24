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
import { eq, inArray } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { receiptItems, receipts, shopProducts, shops } from "@/db/schema";
import { allocateReceiptTotalToLines, salesByItemReport, salesSummaryReport } from "@/services/report_service";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";

// ── Pure: spreading a receipt-level amount over its lines ─────────────────

describe("allocateReceiptTotalToLines", () => {
    const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

    it("splits a percentage discount cleanly", () => {
        expect(allocateReceiptTotalToLines([10, 22, 51, 44], -25.4)).toEqual([8, 17.6, 40.8, 35.2]);
    });

    it("adds a card surcharge the same way", () => {
        const out = allocateReceiptTotalToLines([100, 200], 9);
        expect(sum(out)).toBe(309);
    });

    it("loses no satang on a flat discount that doesn't divide evenly", () => {
        // ฿10 over three equal lines is 3.33 / 3.33 / 3.34 — the remainder has
        // to land somewhere rather than rounding away.
        const out = allocateReceiptTotalToLines([50, 50, 50], -10);
        expect(sum(out)).toBe(140);
        expect(out.every((v) => Number.isInteger(Math.round(v * 100)))).toBe(true);
    });

    it("never invents or drops a satang across awkward splits", () => {
        for (const lines of [[1, 1, 1], [0.01, 99.99], [33.33, 33.33, 33.34], [7, 11, 13, 17, 19]]) {
            for (const delta of [-0.01, -0.07, -1.99, 0.03, 5.55, -12.34]) {
                const out = allocateReceiptTotalToLines(lines, delta);
                expect(sum(out)).toBe(Math.round((sum(lines) + delta) * 100) / 100);
            }
        }
    });

    it("returns the lines untouched when there is nothing to spread", () => {
        expect(allocateReceiptTotalToLines([25, 75], 0)).toEqual([25, 75]);
        expect(allocateReceiptTotalToLines([], -5)).toEqual([]);
    });

    it("weights a refund line by size, not sign", () => {
        // Store allows a negative line on a normal sale. Weighting by the raw
        // value would hand it an inverted share and break the sum.
        const out = allocateReceiptTotalToLines([100, -50], -15);
        expect(sum(out)).toBe(35);
        expect(out[0]).toBeLessThan(100);
        expect(out[1]).toBeLessThan(0);
    });

    it("still balances when every line is worth zero", () => {
        expect(sum(allocateReceiptTotalToLines([0, 0], -3))).toBe(-3);
    });
});

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
/** Outside the reported window on either side — for voids that cross days. */
const PRIOR_DAY = "2031-03-11";
const LATER_DAY = "2031-03-17";
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
    /** Sell it on a different day than the one being reported. */
    dayOverride?: string;
}): Promise<number> {
    const subtotal = opts.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const discount = opts.discount ?? 0;
    const fee = opts.edcCardFee ?? 0;
    const total = Math.round((subtotal - discount + fee) * 100) / 100;

    const [r] = await db
        .insert(receipts)
        .values({
            receiptNumber: `R-${TAG}-${opts.suffix}`,
            transactionDate: `${opts.dayOverride ?? DAY}T${opts.time ?? "10:00:00"}+07:00`,
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

describe("salesByItemReport — Shop column", () => {
    it.if(HAS_DB)(
        "names the shop the sale happened in",
        async () => {
            if (!dbOk) return;
            try {
                const pid = await seedProduct(`${TAG}-SH`);
                await seedReceipt({ suffix: "SH1", lines: [{ productId: pid, qty: 1, unitPrice: 100 }] });

                const [shop] = await db.select({ name: shops.name }).from(shops)
                    .where(eq(shops.id, SHOP_ID)).limit(1);

                for (const net of [true, false]) {
                    const rows = (await report(net)).rows;
                    expect(rows.length).toBeGreaterThan(0);
                    // Present for Sales Report AND Sales by Item Report — they
                    // share this endpoint and both wanted the column.
                    expect(rows.every((r) => r.shop_name === shop.name)).toBe(true);
                }
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "keeps the column filled on a voided receipt's reversal leg",
        async () => {
            if (!dbOk) return;
            // The void leg is built from the same row, but a missed field here
            // would leave half the report's Shop cells blank.
            try {
                const pid = await seedProduct(`${TAG}-SH2`);
                await seedReceipt({
                    suffix: "SH2", lines: [{ productId: pid, qty: 1, unitPrice: 80 }],
                    status: "VOIDED", voidedAt: `${DAY}T12:00:00+07:00`,
                });
                const rows = (await report(true)).rows;
                expect(rows).toHaveLength(2);
                expect(rows.every((r) => typeof r.shop_name === "string" && r.shop_name.length > 0)).toBe(true);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "reports null rather than crashing when the receipt has no shop",
        async () => {
            if (!dbOk) return;
            // receipts.shop_id is nullable (a deleted shop is impossible — there
            // is an FK — but an unassigned one is not), and shops is LEFT JOINed,
            // so the row still has to come back.
            try {
                const pid = await seedProduct(`${TAG}-SH3`);
                await seedReceipt({ suffix: "SH3", lines: [{ productId: pid, qty: 1, unitPrice: 55 }] });
                await db.update(receipts)
                    .set({ shopId: null })
                    .where(eq(receipts.receiptNumber, `R-${TAG}-SH3`));

                // No shop/module filter, or the null-shop receipt is filtered out.
                const rows = (await salesByItemReport({
                    user: adminUser, dateFrom: DAY, dateTo: DAY, netTotals: true,
                })).rows.filter((r) => r.receipt_number === `R-${TAG}-SH3`);
                expect(rows).toHaveLength(1);
                expect(rows[0].shop_name).toBeNull();
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );
});

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
        "shows a voided receipt as a sale leg plus a reversal, netting to zero",
        async () => {
            if (!dbOk) return;
            try {
                const pid = await seedProduct(`${TAG}-E`);
                await seedReceipt({ suffix: "E1", lines: [{ productId: pid, qty: 1, unitPrice: 100 }], time: "09:00:00" });
                await seedReceipt({
                    suffix: "E2",
                    lines: [{ productId: pid, qty: 1, unitPrice: 500 }],
                    discount: 50,
                    status: "VOIDED",
                    voidedAt: `${DAY}T11:00:00+07:00`,
                    time: "10:00:00",
                });

                const out = await report(true);
                const legs = out.rows.filter((r) => r.receipt_number === `R-${TAG}-E2`);

                // Two legs, not one negative row: the sale as it happened, then
                // the reversal dated when it was actually voided.
                expect(legs).toHaveLength(2);
                const sale = legs.find((r) => r.status === "ACTIVE")!;
                const reversal = legs.find((r) => r.status === "VOIDED")!;
                expect(sale.sales_amt).toBeCloseTo(450, 2);      // 500 − 50 discount
                expect(reversal.sales_amt).toBeCloseTo(-450, 2);
                expect(sale.sales_qty).toBe(1);
                expect(reversal.sales_qty).toBe(-1);
                expect(reversal.transaction_date).not.toBe(sale.transaction_date);

                // They cancel, so only the live receipt is left in the total.
                expect(out.totals.sales_amt).toBeCloseTo(100, 2);
                expect(out.totals.sales_qty).toBe(1);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "counts the reversal of a receipt that was sold before the window",
        async () => {
            if (!dbOk) return;
            // This is the ฿72.00 that left Sales Report high on 2026-08-10:
            // sold 7 Aug, voided 10 Aug. Daily books the reversal on the 10th;
            // Sales Report used to show nothing at all because it filtered on
            // the sale date.
            try {
                const pid = await seedProduct(`${TAG}-H`);
                await seedReceipt({ suffix: "H1", lines: [{ productId: pid, qty: 1, unitPrice: 200 }], time: "09:00:00" });
                await seedReceipt({
                    suffix: "H2",
                    lines: [{ productId: pid, qty: 1, unitPrice: 72 }],
                    status: "VOIDED",
                    time: "10:00:00",
                    dayOverride: PRIOR_DAY,               // sold three days earlier
                    voidedAt: `${DAY}T10:49:00+07:00`,    // voided inside the window
                });

                const out = await report(true);
                const legs = out.rows.filter((r) => r.receipt_number === `R-${TAG}-H2`);
                expect(legs).toHaveLength(1);             // reversal only — no sale leg
                expect(legs[0].status).toBe("VOIDED");
                expect(legs[0].sales_amt).toBeCloseTo(-72, 2);

                expect(out.totals.sales_amt).toBeCloseTo(128, 2); // 200 − 72

                const summary = await salesSummaryReport({
                    user: adminUser, dateFrom: DAY, dateTo: DAY, shopId: SHOP_ID,
                });
                expect(out.totals.sales_amt).toBeCloseTo(summary.totals.amt_billing, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "keeps only the sale leg when the void happens after the window",
        async () => {
            if (!dbOk) return;
            // Mirror of the case above. Daily books the sale on the day it was
            // sold and the reversal on a later day, so a report for the sale day
            // must still show the full sale.
            try {
                const pid = await seedProduct(`${TAG}-I`);
                await seedReceipt({
                    suffix: "I1",
                    lines: [{ productId: pid, qty: 1, unitPrice: 90 }],
                    status: "VOIDED",
                    voidedAt: `${LATER_DAY}T08:00:00+07:00`,
                });

                const out = await report(true);
                const legs = out.rows.filter((r) => r.receipt_number === `R-${TAG}-I1`);
                expect(legs).toHaveLength(1);
                expect(legs[0].status).toBe("ACTIVE");
                expect(out.totals.sales_amt).toBeCloseTo(90, 2);

                const summary = await salesSummaryReport({
                    user: adminUser, dateFrom: DAY, dateTo: DAY, shopId: SHOP_ID,
                });
                expect(out.totals.sales_amt).toBeCloseTo(summary.totals.amt_billing, 2);
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
        "prints a total you can reach by adding up the visible column",
        async () => {
            if (!dbOk) return;
            // The complaint that started this: summing Sales AMT. in Excel gave
            // ฿210,321.75 against a printed ฿210,245.55. Every row must count
            // toward the total and every receipt-level figure must live on a
            // row, or the two can never meet.
            try {
                const pid = await seedProduct(`${TAG}-J`);
                await seedReceipt({ suffix: "J1", lines: [{ productId: pid, qty: 2, unitPrice: 50 }], discount: 20, time: "09:00:00" });
                await seedReceipt({ suffix: "J2", lines: [{ productId: pid, qty: 1, unitPrice: 310 }], edcCardFee: 9.3, time: "10:00:00" });
                await seedReceipt({
                    suffix: "J3",
                    lines: [{ productId: pid, qty: 1, unitPrice: 55 }, { productId: pid, qty: 1, unitPrice: 50 }],
                    status: "VOIDED",
                    voidedAt: `${DAY}T12:00:00+07:00`,
                    time: "11:00:00",
                });
                await seedReceipt({
                    suffix: "J4",
                    lines: [{ productId: pid, qty: 1, unitPrice: 72 }],
                    status: "VOIDED",
                    dayOverride: PRIOR_DAY,
                    voidedAt: `${DAY}T13:00:00+07:00`,
                });

                const out = await report(true);
                const columnSum = out.rows.reduce((a, r) => a + r.sales_amt, 0);
                expect(columnSum).toBeCloseTo(out.totals.sales_amt, 2);
                expect(out.totals.sales_amt).toBeCloseTo(327.30, 2); // 80 + 319.30 + 0 − 72

                const qtySum = out.rows.reduce((a, r) => a + r.sales_qty, 0);
                expect(qtySum).toBe(out.totals.sales_qty);

                const summary = await salesSummaryReport({
                    user: adminUser, dateFrom: DAY, dateTo: DAY, shopId: SHOP_ID,
                });
                expect(out.totals.sales_amt).toBeCloseTo(summary.totals.amt_billing, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "spreads a bill discount across the lines so they add up to the bill",
        async () => {
            if (!dbOk) return;
            try {
                const pid = await seedProduct(`${TAG}-K`);
                // 10 + 22 + 51 + 44 = 127 less 20% → 8.00 + 17.60 + 40.80 + 35.20
                await seedReceipt({
                    suffix: "K1",
                    lines: [
                        { productId: pid, qty: 1, unitPrice: 10 },
                        { productId: pid, qty: 1, unitPrice: 22 },
                        { productId: pid, qty: 1, unitPrice: 51 },
                        { productId: pid, qty: 1, unitPrice: 44 },
                    ],
                    discount: 25.4,
                });

                const out = await report(true);
                const amts = out.rows.map((r) => r.sales_amt).sort((a, b) => a - b);
                expect(amts).toEqual([8, 17.6, 35.2, 40.8]);
                expect(amts.reduce((a, b) => a + b, 0)).toBeCloseTo(101.6, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "leaves Sales by Item Report alone — raw line amounts, voided rows dropped",
        async () => {
            if (!dbOk) return;
            // The other report card shares this endpoint. It must keep showing
            // what each item rang up at, with a voided receipt as a single
            // negative row that the total ignores.
            try {
                const pid = await seedProduct(`${TAG}-G`);
                await seedReceipt({ suffix: "G1", lines: [{ productId: pid, qty: 2, unitPrice: 50 }], discount: 20, time: "09:00:00" });
                await seedReceipt({
                    suffix: "G2",
                    lines: [{ productId: pid, qty: 1, unitPrice: 40 }],
                    status: "VOIDED",
                    voidedAt: `${DAY}T11:00:00+07:00`,
                    time: "10:00:00",
                });

                const off = await report(false);
                expect(off.rows.filter((r) => r.receipt_number === `R-${TAG}-G1`).map((r) => r.sales_amt))
                    .toEqual([100]);                       // gross, discount not applied to the row
                const voided = off.rows.filter((r) => r.receipt_number === `R-${TAG}-G2`);
                expect(voided).toHaveLength(1);            // one negative row, no sale leg
                expect(voided[0].sales_amt).toBeCloseTo(-40, 2);
                expect(off.totals.sales_amt).toBeCloseTo(100, 2); // voided row excluded
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );
});
