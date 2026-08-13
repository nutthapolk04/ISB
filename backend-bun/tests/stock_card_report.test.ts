/**
 * Stock Card report — valuation and totals.
 *
 * Two changes landed here on 2026-08-07 and both need pinning:
 *
 *  1. **Amt In / Amt Out are cost, not revenue.** They used to switch to
 *     `sale_amount` (the real receipt line_total) for sale legs — added in
 *     c451005 for revenue tracking, reverted because this is a stock card:
 *     both amount columns must read as inventory value moving in and out.
 *     `sale_amount` is still written to shop_movements and still used by
 *     balance_file_service, so the two reports now answer different questions
 *     on purpose. A future "let's make these consistent again" change would
 *     silently reintroduce selling prices here; these tests are the guard.
 *
 *  2. **Grand Total.** One line at the end of the report summing the
 *     per-product totals.
 *
 * Conventions mirror adjustment_report.test.ts / edc_telemetry.test.ts — pure
 * cases run anywhere, DB cases are gated on a localhost DATABASE_URL and clean
 * up after themselves rather than truncating.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { shopProducts, shopMovements } from "@/db/schema";
import {
    stockCardReport,
    sumStockCardGrandTotal,
    type StockCardProductBlockDTO,
} from "@/services/report_service";
import { receiveStock } from "@/services/shop_product_service";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";

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
            "[stock_card_report] Skipping DB-backed cases: DATABASE_URL is not localhost. " +
            "These tests write fixture rows and must not run against a shared database.",
        );
    }
    if (HAS_DB) dbOk = await pingDb();
});

// ── Pure: grand total arithmetic ──────────────────────────────────────────

function block(over: Partial<StockCardProductBlockDTO> = {}): StockCardProductBlockDTO {
    return {
        product_variant_id: 1,
        product_code: "P1",
        product_name: "Product 1",
        rows: [],
        total_qty_in: 0,
        total_qty_out: 0,
        total_amount_in: 0,
        total_amount_out: 0,
        closing_amount_balance: 0,
        ...over,
    };
}

describe("sumStockCardGrandTotal", () => {
    it("adds up every product's totals", () => {
        const out = sumStockCardGrandTotal([
            block({ total_qty_in: 10, total_qty_out: 3, total_amount_in: 500, total_amount_out: 120, closing_amount_balance: 380 }),
            block({ total_qty_in: 5, total_qty_out: 1, total_amount_in: 250, total_amount_out: 50, closing_amount_balance: 200 }),
        ]);
        expect(out).toEqual({
            qty_in: 15,
            qty_out: 4,
            amount_in: 750,
            amount_out: 170,
            amount_balance: 580,
        });
    });

    it("sums the already-rounded per-product figures", () => {
        // A reader adding the visible column by hand must get the printed Grand
        // Total. Rounding the raw sum instead can land a satang away from that.
        const out = sumStockCardGrandTotal([
            block({ total_amount_in: 0.33, closing_amount_balance: 0.33 }),
            block({ total_amount_in: 0.33, closing_amount_balance: 0.33 }),
            block({ total_amount_in: 0.34, closing_amount_balance: 0.34 }),
        ]);
        expect(out.amount_in).toBe(1);
        expect(out.amount_balance).toBe(1);
    });

    it("is all zeros for an empty report rather than undefined", () => {
        expect(sumStockCardGrandTotal([])).toEqual({
            qty_in: 0, qty_out: 0, amount_in: 0, amount_out: 0, amount_balance: 0,
        });
    });

    it("does not drift on repeated satang values", () => {
        const many = Array.from({ length: 10 }, () => block({ total_amount_out: 1.15 }));
        expect(sumStockCardGrandTotal(many).amount_out).toBe(11.5);
    });
});

// ── DB-backed: valuation ──────────────────────────────────────────────────

const TAG = `sc-${Date.now().toString(36)}`;
const SHOP_ID = "S0001";

const adminUser = { sub: "1", roles: ["admin"], shop_id: null } as unknown as AccessTokenPayload;

/** A product with a known movement history, isolated by a run-unique code. */
async function seedProduct(opts: {
    code: string;
    avgCost: number;
    stock: number;
}): Promise<number> {
    const [p] = await db
        .insert(shopProducts)
        .values({
            shopId: SHOP_ID,
            productCode: opts.code,
            name: `${opts.code} fixture`,
            category: "TEST",
            externalPrice: "999.00",
            internalPrice: String(opts.avgCost),
            avgCost: String(opts.avgCost),
            stock: opts.stock,
            isActive: true,
            vatPercent: "0",
            minStock: 0,
        })
        .returning({ id: shopProducts.id });
    return p.id;
}

async function seedMovement(opts: {
    productId: number;
    type: "receive" | "sale" | "void";
    quantity: number;
    stockBefore: number;
    stockAfter: number;
    costPerUnit: number | null;
    saleAmount: number | null;
    date: string;
    createdAt: string;
    receivedDate?: string | null;
}): Promise<number> {
    const [m] = await db
        .insert(shopMovements)
        .values({
            date: opts.date,
            productId: opts.productId,
            productName: "fixture",
            shopId: SHOP_ID,
            type: opts.type,
            quantity: opts.quantity,
            stockBefore: opts.stockBefore,
            stockAfter: opts.stockAfter,
            costPerUnit: opts.costPerUnit === null ? null : String(opts.costPerUnit),
            saleAmount: opts.saleAmount === null ? null : String(opts.saleAmount),
            createdAt: opts.createdAt,
            receivedDate: opts.receivedDate ?? null,
        })
        .returning({ id: shopMovements.id });
    return m.id;
}

describe("stockCardReport (DB) — Amt In / Amt Out are cost, never revenue", () => {
    it.if(HAS_DB)(
        "values a sale at cost even when sale_amount says it sold for far more",
        async () => {
            if (!dbOk) return;
            const code = `${TAG}-A`;
            const productIds: number[] = [];
            const movementIds: number[] = [];
            try {
                // Cost ฿40, sold for ฿150. The report must show 2 × 40 = 80,
                // NOT the 300 of revenue — that is what regressed before.
                const pid = await seedProduct({ code, avgCost: 40, stock: 8 });
                productIds.push(pid);
                movementIds.push(await seedMovement({
                    productId: pid, type: "receive", quantity: 10,
                    stockBefore: 0, stockAfter: 10, costPerUnit: 40, saleAmount: null,
                    date: "2026-03-02", createdAt: "2026-03-02T03:00:00.000Z",
                }));
                movementIds.push(await seedMovement({
                    productId: pid, type: "sale", quantity: 2,
                    stockBefore: 10, stockAfter: 8, costPerUnit: null, saleAmount: 300,
                    date: "2026-03-03", createdAt: "2026-03-03T03:00:00.000Z",
                }));

                const res = await stockCardReport({
                    user: adminUser, shopId: SHOP_ID,
                    dateFrom: "2026-03-01", dateTo: "2026-03-31",
                    productSearch: code,
                });
                const b = res.products.find((x) => x.product_code === code);
                expect(b).toBeDefined();

                const saleRow = b!.rows.find((r) => r.description === "Sales");
                expect(saleRow?.amount_out).toBe(80);      // 2 × ฿40 cost
                expect(saleRow?.amount_out).not.toBe(300); // never the revenue
                expect(b!.total_amount_out).toBe(80);

                // The receive leg is valued at what was actually paid.
                const recvRow = b!.rows.find((r) => r.description === "Receive");
                expect(recvRow?.amount_in).toBe(400);      // 10 × ฿40
                expect(b!.total_amount_in).toBe(400);
            } finally {
                if (movementIds.length) await db.delete(shopMovements).where(inArray(shopMovements.id, movementIds));
                if (productIds.length) await db.delete(shopProducts).where(inArray(shopProducts.id, productIds));
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "values a void's returning stock at cost, not at the refunded amount",
        async () => {
            if (!dbOk) return;
            const code = `${TAG}-B`;
            const productIds: number[] = [];
            const movementIds: number[] = [];
            try {
                const pid = await seedProduct({ code, avgCost: 25, stock: 10 });
                productIds.push(pid);
                movementIds.push(await seedMovement({
                    productId: pid, type: "receive", quantity: 10,
                    stockBefore: 0, stockAfter: 10, costPerUnit: 25, saleAmount: null,
                    date: "2026-03-02", createdAt: "2026-03-02T03:00:00.000Z",
                }));
                movementIds.push(await seedMovement({
                    productId: pid, type: "sale", quantity: 4,
                    stockBefore: 10, stockAfter: 6, costPerUnit: null, saleAmount: 400,
                    date: "2026-03-03", createdAt: "2026-03-03T03:00:00.000Z",
                }));
                // Void returns the stock; the refund was ฿400 but the inventory
                // coming back is worth 4 × ฿25.
                movementIds.push(await seedMovement({
                    productId: pid, type: "void", quantity: 4,
                    stockBefore: 6, stockAfter: 10, costPerUnit: null, saleAmount: 400,
                    date: "2026-03-04", createdAt: "2026-03-04T03:00:00.000Z",
                }));

                const res = await stockCardReport({
                    user: adminUser, shopId: SHOP_ID,
                    dateFrom: "2026-03-01", dateTo: "2026-03-31",
                    productSearch: code,
                });
                const b = res.products.find((x) => x.product_code === code)!;
                const voidRow = b.rows.find((r) => r.description === "Void");
                expect(voidRow?.amount_in).toBe(100);      // 4 × ฿25
                expect(voidRow?.amount_in).not.toBe(400);
            } finally {
                if (movementIds.length) await db.delete(shopMovements).where(inArray(shopMovements.id, movementIds));
                if (productIds.length) await db.delete(shopProducts).where(inArray(shopProducts.id, productIds));
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "keeps Amt In / Amt Out consistent with Qty × Cost/Unit on every row",
        async () => {
            if (!dbOk) return;
            // The invariant a reader checks by eye. It held only by accident
            // while sale_amount was in play — a sale row showed revenue in
            // Amt Out next to a cost basis in Cost/Unit, and the two did not
            // multiply out.
            const code = `${TAG}-C`;
            const productIds: number[] = [];
            const movementIds: number[] = [];
            try {
                const pid = await seedProduct({ code, avgCost: 12.5, stock: 7 });
                productIds.push(pid);
                movementIds.push(await seedMovement({
                    productId: pid, type: "receive", quantity: 10,
                    stockBefore: 0, stockAfter: 10, costPerUnit: 12.5, saleAmount: null,
                    date: "2026-03-02", createdAt: "2026-03-02T03:00:00.000Z",
                }));
                movementIds.push(await seedMovement({
                    productId: pid, type: "sale", quantity: 3,
                    stockBefore: 10, stockAfter: 7, costPerUnit: null, saleAmount: 199.99,
                    date: "2026-03-05", createdAt: "2026-03-05T03:00:00.000Z",
                }));

                const res = await stockCardReport({
                    user: adminUser, shopId: SHOP_ID,
                    dateFrom: "2026-03-01", dateTo: "2026-03-31",
                    productSearch: code,
                });
                const b = res.products.find((x) => x.product_code === code)!;
                for (const r of b.rows) {
                    if (r.qty_in > 0) {
                        expect(r.amount_in).toBeCloseTo(r.qty_in * r.cost_per_unit, 2);
                    }
                    if (r.qty_out > 0) {
                        expect(r.amount_out).toBeCloseTo(r.qty_out * r.cost_per_unit, 2);
                    }
                }
            } finally {
                if (movementIds.length) await db.delete(shopMovements).where(inArray(shopMovements.id, movementIds));
                if (productIds.length) await db.delete(shopProducts).where(inArray(shopProducts.id, productIds));
            }
        },
        DB_TIMEOUT_MS,
    );
});

describe("stockCardReport (DB) — Grand Total", () => {
    it.if(HAS_DB)(
        "sums across products and counts only what the filter left visible",
        async () => {
            if (!dbOk) return;
            const codeA = `${TAG}-G1`;
            const codeB = `${TAG}-G2`;
            const productIds: number[] = [];
            const movementIds: number[] = [];
            try {
                for (const [code, cost] of [[codeA, 10], [codeB, 20]] as const) {
                    const pid = await seedProduct({ code, avgCost: cost, stock: 8 });
                    productIds.push(pid);
                    movementIds.push(await seedMovement({
                        productId: pid, type: "receive", quantity: 10,
                        stockBefore: 0, stockAfter: 10, costPerUnit: cost, saleAmount: null,
                        date: "2026-04-02", createdAt: "2026-04-02T03:00:00.000Z",
                    }));
                    movementIds.push(await seedMovement({
                        productId: pid, type: "sale", quantity: 2,
                        stockBefore: 10, stockAfter: 8, costPerUnit: null, saleAmount: 999,
                        date: "2026-04-03", createdAt: "2026-04-03T03:00:00.000Z",
                    }));
                }

                const res = await stockCardReport({
                    user: adminUser, shopId: SHOP_ID,
                    dateFrom: "2026-04-01", dateTo: "2026-04-30",
                    productSearch: TAG,
                });
                expect(res.products).toHaveLength(2);
                expect(res.grand_total.qty_in).toBe(20);
                expect(res.grand_total.qty_out).toBe(4);
                expect(res.grand_total.amount_in).toBe(300);   // 10×10 + 10×20
                expect(res.grand_total.amount_out).toBe(60);   // 2×10 + 2×20
                expect(res.grand_total.amount_balance).toBe(240); // 8×10 + 8×20

                // Narrowing the search must narrow the Grand Total with it —
                // a total covering rows the reader cannot see never reconciles.
                const one = await stockCardReport({
                    user: adminUser, shopId: SHOP_ID,
                    dateFrom: "2026-04-01", dateTo: "2026-04-30",
                    productSearch: codeA,
                });
                expect(one.products).toHaveLength(1);
                expect(one.grand_total.amount_in).toBe(100);
                expect(one.grand_total.amount_balance).toBe(80);
            } finally {
                if (movementIds.length) await db.delete(shopMovements).where(inArray(shopMovements.id, movementIds));
                if (productIds.length) await db.delete(shopProducts).where(inArray(shopProducts.id, productIds));
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "equals the sum of the per-product Total rows",
        async () => {
            if (!dbOk) return;
            // The Grand Total and the per-product TOTAL lines sit on the same
            // page; if they disagree the report is not trustworthy.
            const res = await stockCardReport({
                user: adminUser, shopId: SHOP_ID,
                dateFrom: "2026-01-01", dateTo: "2026-12-31",
            });
            const expected = res.products.reduce(
                (acc, p) => ({
                    qty_in: acc.qty_in + p.total_qty_in,
                    qty_out: acc.qty_out + p.total_qty_out,
                    amount_in: Math.round((acc.amount_in + p.total_amount_in) * 100) / 100,
                    amount_out: Math.round((acc.amount_out + p.total_amount_out) * 100) / 100,
                }),
                { qty_in: 0, qty_out: 0, amount_in: 0, amount_out: 0 },
            );
            expect(res.grand_total.qty_in).toBe(expected.qty_in);
            expect(res.grand_total.qty_out).toBe(expected.qty_out);
            expect(res.grand_total.amount_in).toBeCloseTo(expected.amount_in, 2);
            expect(res.grand_total.amount_out).toBeCloseTo(expected.amount_out, 2);
        },
        DB_TIMEOUT_MS,
    );
});

// ── received_date ─────────────────────────────────────────────────────────

describe("stockCardReport (DB) — received_date is display-only", () => {
    it.if(HAS_DB)(
        "surfaces the delivery date on receive rows and null everywhere else",
        async () => {
            if (!dbOk) return;
            const code = `${TAG}-RD`;
            const productIds: number[] = [];
            const movementIds: number[] = [];
            try {
                const pid = await seedProduct({ code, avgCost: 30, stock: 8 });
                productIds.push(pid);
                // Goods arrived on the 1st, keyed in on the 5th.
                movementIds.push(await seedMovement({
                    productId: pid, type: "receive", quantity: 10,
                    stockBefore: 0, stockAfter: 10, costPerUnit: 30, saleAmount: null,
                    date: "2026-05-05", createdAt: "2026-05-05T03:00:00.000Z",
                    receivedDate: "2026-05-01",
                }));
                movementIds.push(await seedMovement({
                    productId: pid, type: "sale", quantity: 2,
                    stockBefore: 10, stockAfter: 8, costPerUnit: null, saleAmount: 500,
                    date: "2026-05-06", createdAt: "2026-05-06T03:00:00.000Z",
                    receivedDate: null,
                }));

                const res = await stockCardReport({
                    user: adminUser, shopId: SHOP_ID,
                    dateFrom: "2026-05-01", dateTo: "2026-05-31",
                    productSearch: code,
                });
                const b = res.products.find((x) => x.product_code === code)!;

                const recv = b.rows.find((r) => r.description === "Receive")!;
                expect(recv.received_date).toBe("2026-05-01");
                // The Date column still shows the entry date, not the delivery
                // date — the two are meant to sit side by side.
                expect(recv.date?.slice(0, 10)).toBe("2026-05-05");

                // Only a receive has a delivery date; the UI prints "-" for the rest.
                for (const r of b.rows.filter((x) => x.description !== "Receive")) {
                    expect(r.received_date).toBeNull();
                }
            } finally {
                if (movementIds.length) await db.delete(shopMovements).where(inArray(shopMovements.id, movementIds));
                if (productIds.length) await db.delete(shopProducts).where(inArray(shopProducts.id, productIds));
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "changes NOTHING about ordering, balances or cost when a receive is backdated",
        async () => {
            if (!dbOk) return;
            // The load-bearing guarantee of this feature: received_date is
            // informational. Two products with identical histories — one with a
            // backdated delivery, one without — must produce identical rows in
            // every column except received_date itself. If that ever stops
            // being true, balances and average cost have started depending on a
            // hand-typed date and will disagree with balance_file_service and
            // shop_products.avg_cost.
            const plain = `${TAG}-N1`;
            const backdated = `${TAG}-N2`;
            const productIds: number[] = [];
            const movementIds: number[] = [];
            try {
                for (const [code, recvDate] of [[plain, null], [backdated, "2026-06-01"]] as const) {
                    const pid = await seedProduct({ code, avgCost: 50, stock: 5 });
                    productIds.push(pid);
                    movementIds.push(await seedMovement({
                        productId: pid, type: "receive", quantity: 10,
                        stockBefore: 0, stockAfter: 10, costPerUnit: 50, saleAmount: null,
                        date: "2026-06-10", createdAt: "2026-06-10T03:00:00.000Z",
                        receivedDate: recvDate,
                    }));
                    movementIds.push(await seedMovement({
                        productId: pid, type: "sale", quantity: 5,
                        stockBefore: 10, stockAfter: 5, costPerUnit: null, saleAmount: 800,
                        date: "2026-06-11", createdAt: "2026-06-11T03:00:00.000Z",
                        receivedDate: null,
                    }));
                }

                const res = await stockCardReport({
                    user: adminUser, shopId: SHOP_ID,
                    dateFrom: "2026-06-01", dateTo: "2026-06-30",
                    productSearch: `${TAG}-N`,
                });
                const a = res.products.find((x) => x.product_code === plain)!;
                const c = res.products.find((x) => x.product_code === backdated)!;

                const strip = (b: typeof a) => b.rows.map(({ received_date, ...rest }) => rest);
                expect(strip(c)).toEqual(strip(a));
                expect(c.total_qty_in).toBe(a.total_qty_in);
                expect(c.total_amount_out).toBe(a.total_amount_out);
                expect(c.closing_amount_balance).toBe(a.closing_amount_balance);

                // …and the delivery date really did differ, so the comparison
                // above was not vacuous.
                expect(c.rows.find((r) => r.description === "Receive")!.received_date).toBe("2026-06-01");
                expect(a.rows.find((r) => r.description === "Receive")!.received_date).toBeNull();
            } finally {
                if (movementIds.length) await db.delete(shopMovements).where(inArray(shopMovements.id, movementIds));
                if (productIds.length) await db.delete(shopProducts).where(inArray(shopProducts.id, productIds));
            }
        },
        DB_TIMEOUT_MS,
    );
});

// ── Write path ────────────────────────────────────────────────────────────

describe("receiveStock — received_date", () => {
    it.if(HAS_DB)(
        "stores the entered delivery date without moving the entry date",
        async () => {
            if (!dbOk) return;
            const code = `${TAG}-W1`;
            const productIds: number[] = [];
            try {
                const pid = await seedProduct({ code, avgCost: 0, stock: 0 });
                productIds.push(pid);
                await receiveStock({
                    shopId: SHOP_ID,
                    userId: 1,
                    items: [{ product_id: pid, qty: 5, cost_per_unit: 12, received_date: "2026-02-14" }],
                });
                const [m] = await db.select().from(shopMovements)
                    .where(eq(shopMovements.productId, pid));
                expect(m.receivedDate).toBe("2026-02-14");
                // `date` is what balance_file / monthly_stock / the period-close
                // backdate check read — it must stay the day of entry.
                expect(m.date).toBe(new Date().toISOString().slice(0, 10));
            } finally {
                await db.delete(shopMovements).where(inArray(shopMovements.productId, productIds));
                if (productIds.length) await db.delete(shopProducts).where(inArray(shopProducts.id, productIds));
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "falls back to today when the date is omitted or malformed",
        async () => {
            if (!dbOk) return;
            // Callers that predate this field (an older frontend bundle, the
            // xlsx importer) send nothing — they must keep working, stamped
            // with today exactly as before.
            const today = new Date().toISOString().slice(0, 10);
            const productIds: number[] = [];
            try {
                for (const bad of [undefined, null, "", "14/02/2026", "not-a-date", "2026-2-4"]) {
                    const code = `${TAG}-W-${String(bad).slice(0, 6)}-${productIds.length}`;
                    const pid = await seedProduct({ code, avgCost: 0, stock: 0 });
                    productIds.push(pid);
                    await receiveStock({
                        shopId: SHOP_ID,
                        userId: 1,
                        items: [{ product_id: pid, qty: 1, cost_per_unit: 1, received_date: bad as string | null | undefined }],
                    });
                    const [m] = await db.select().from(shopMovements)
                        .where(eq(shopMovements.productId, pid));
                    expect(m.receivedDate).toBe(today);
                }
            } finally {
                if (productIds.length) {
                    await db.delete(shopMovements).where(inArray(shopMovements.productId, productIds));
                    await db.delete(shopProducts).where(inArray(shopProducts.id, productIds));
                }
            }
        },
        DB_TIMEOUT_MS,
    );
});
