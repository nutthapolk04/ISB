/**
 * Balance File — the opening cost basis.
 *
 * The ledger rebuilds the weighted average from shop_movements starting at
 * {qty:0, avg:0}, and only a `receive` row ever moves it. A product imported
 * with stock 0 gets no movement at all (the import skips receiveStock for a
 * zero quantity), so its cost basis lived only on shop_products.avg_cost and
 * this report never saw it: every sale before the first real delivery was
 * valued at ฿0, and the delivery then had to absorb the whole cost across
 * whatever stock was left.
 *
 * That is the ฿221.5804 incident — 400 units at ฿203.30 received into stock of
 * -33 reported 81,320 / 367. Selling into negative stock is intentional here, so
 * the fix is NOT to rewrite the stock history: the report now falls back to the
 * product's own avg_cost when there is no prior history, which is what
 * report_service.ts's Stock Card has always done for this case. The two reports
 * agree as a result.
 *
 * The load-bearing cases:
 *   - fallback applies ONLY when there is no history before the period; a
 *     product with real history must never have its replay overridden by a
 *     mutable column;
 *   - only the COST falls back, never the quantity;
 *   - Stock Card and Balance File land on the same number.
 *
 * Conventions mirror the other DB-backed suites: localhost-only, run-unique
 * fixtures, cleaned up in `finally`.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { eq, inArray, like } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { shopProducts, shopMovements } from "@/db/schema";
import { getBalanceFile } from "@/services/balance_file_service";
import { stockCardReport } from "@/services/report_service";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";

const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
const DB_TIMEOUT_MS = 45_000;

const SHOP_ID = "S0001";
const TAG = `bfo-${Date.now().toString(36)}`;
const adminUser = { sub: "1", roles: ["admin"], shop_id: null } as unknown as AccessTokenPayload;

beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    }
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn(
            "[balance_file_opening_cost] Skipping DB-backed cases: DATABASE_URL is not localhost. " +
            "These tests write fixture rows and must not run against a shared database.",
        );
    }
    if (HAS_DB) dbOk = await pingDb();
});

async function seedProduct(code: string, avgCost: number, stock: number): Promise<number> {
    const [p] = await db
        .insert(shopProducts)
        .values({
            shopId: SHOP_ID, productCode: code, name: `${code} fixture`, category: "TEST",
            externalPrice: "255.00", internalPrice: String(avgCost), avgCost: avgCost.toFixed(4),
            stock, isActive: true, vatPercent: "0", minStock: 0,
        })
        .returning({ id: shopProducts.id });
    return p.id;
}

/** Movements in insertion order, one minute apart so created_at sorts stably. */
function mover(productId: number, code: string) {
    let clock = new Date("2026-08-06T01:00:00Z").getTime();
    let stock = 0;
    return {
        get stock() { return stock; },
        async add(opts: {
            type: typeof shopMovements.$inferInsert["type"];
            delta: number; cost: string | null; day?: string; at?: string;
        }) {
            const before = stock;
            stock += opts.delta;
            await db.insert(shopMovements).values({
                date: opts.day ?? "2026-08-06",
                productId, productName: `${code} fixture`, shopId: SHOP_ID,
                type: opts.type, quantity: opts.delta,
                stockBefore: before, stockAfter: stock,
                costPerUnit: opts.cost,
                createdAt: opts.at ?? new Date((clock += 60_000)).toISOString(),
                createdBy: 1,
            });
        },
        setStock(v: number) { stock = v; },
    };
}

async function cleanup(): Promise<void> {
    const rows = await db.select({ id: shopProducts.id }).from(shopProducts)
        .where(like(shopProducts.productCode, `${TAG}%`));
    const ids = rows.map((r) => r.id);
    if (ids.length) {
        await db.delete(shopMovements).where(inArray(shopMovements.productId, ids));
        await db.delete(shopProducts).where(inArray(shopProducts.id, ids));
    }
}

/** The 197 shape: imported with stock 0, sold into negative, then one delivery. */
async function seed197Shape(code: string, avgCost: number): Promise<number> {
    const pid = await seedProduct(code, avgCost, 365);
    const mv = mover(pid, code);
    // 35 units out, 2 back via a void — net -33, all at cost 0.
    const deltas = [-1, -1, -1, -1, -1, -1, -2, -1, -2, +2,
        -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
        -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];
    for (const d of deltas) await mv.add({ type: d > 0 ? "void" : "sale", delta: d, cost: "0.0000" });
    await mv.add({ type: "receive", delta: 400, cost: "203.3000", day: "2026-08-10" });
    await mv.add({ type: "sale", delta: -1, cost: "203.3000", day: "2026-08-11" });
    await mv.add({ type: "sale", delta: -1, cost: "203.3000", day: "2026-08-11" });
    return pid;
}

const august = (pid: number) => getBalanceFile(SHOP_ID, 2026, 8, pid);

describe("getBalanceFile — opening cost basis", () => {
    it.if(HAS_DB)(
        "values the whole period at the product's avg_cost when there is no prior history",
        async () => {
            if (!dbOk) return;
            try {
                const pid = await seed197Shape(`${TAG}-A`, 203.3);
                const block = (await august(pid)).blocks[0];
                const rows = block.rows;

                // Every place the average surfaces has to read 203.30 — the old
                // behaviour gave 0 at the top and 221.5804 from the delivery on.
                expect(rows[0].bal_avg_cost).toBeCloseTo(203.3, 4);            // Opening
                expect(rows.find((r) => r.out_qty)!.out_avg_cost).toBeCloseTo(203.3, 4);
                expect(rows.find((r) => (r.in_qty ?? 0) >= 400)!.bal_avg_cost).toBeCloseTo(203.3, 4);
                expect(block.summary.final_avg_cost).toBeCloseTo(203.3, 4);
                expect(block.summary.final_qty).toBe(365);
                expect(block.summary.final_value).toBeCloseTo(74204.5, 2);      // 365 × 203.30
                // 37 units out at a real cost instead of ฿0.
                expect(block.summary.out_amount).toBeCloseTo(7522.1, 2);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "leaves the negative stock exactly as recorded",
        async () => {
            if (!dbOk) return;
            // Selling below zero is deliberate in this shop. The fix must value
            // the movements differently, never rewrite them.
            try {
                const pid = await seed197Shape(`${TAG}-B`, 203.3);
                await august(pid);

                const moves = await db.select().from(shopMovements)
                    .where(eq(shopMovements.productId, pid))
                    .orderBy(shopMovements.createdAt);
                expect(moves[0].stockBefore).toBe(0);
                expect(moves[0].stockAfter).toBe(-1);
                expect(moves.filter((m) => m.stockAfter < 0).length).toBeGreaterThan(30);
                // The delivery is still the single 400-unit row it always was.
                const receives = moves.filter((m) => m.type === "receive");
                expect(receives).toHaveLength(1);
                expect(receives[0].quantity).toBe(400);
                expect(receives[0].stockBefore).toBe(-33);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "ignores avg_cost once real history exists before the period",
        async () => {
            if (!dbOk) return;
            // The reason to be careful: avg_cost is a live, mutable column. A
            // product with a genuine ledger must be valued from that ledger, or
            // a past month's report would move whenever today's cost moves.
            try {
                const code = `${TAG}-C`;
                const pid = await seedProduct(code, 999, 100);   // avg_cost deliberately wrong
                const mv = mover(pid, code);
                await mv.add({ type: "receive", delta: 100, cost: "100.0000", day: "2026-07-05", at: "2026-07-05T03:00:00Z" });
                await mv.add({ type: "sale", delta: -10, cost: "100.0000", day: "2026-08-07", at: "2026-08-07T03:00:00Z" });

                const block = (await august(pid)).blocks[0];
                expect(block.rows[0].bal_avg_cost).toBeCloseTo(100, 4);   // replayed, not 999
                expect(block.summary.final_avg_cost).toBeCloseTo(100, 4);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "falls back on the cost only — opening quantity stays 0",
        async () => {
            if (!dbOk) return;
            // Quantity must keep coming from the movements; the first one sets it
            // from stock_after absolutely, so a wrong opening qty would show up
            // as a phantom balance on the Opening row.
            try {
                const pid = await seed197Shape(`${TAG}-D`, 203.3);
                const rows = (await august(pid)).blocks[0].rows;
                expect(rows[0].bal_qty).toBe(0);
                expect(rows[0].bal_total_value).toBe(0);   // 0 × 203.30
                expect(rows[1].bal_qty).toBe(-1);          // self-corrects immediately
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "still reports 0 when the product itself has no cost either",
        async () => {
            if (!dbOk) return;
            // Nothing to fall back to is not an error — it just means the cost
            // genuinely isn't known yet.
            try {
                const pid = await seed197Shape(`${TAG}-E`, 0);
                const block = (await august(pid)).blocks[0];
                expect(block.rows[0].bal_avg_cost).toBe(0);
                expect(block.summary.final_avg_cost).toBeCloseTo(221.5804, 4); // 81,320 / 367
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "agrees with Stock Card on the same product",
        async () => {
            if (!dbOk) return;
            // The whole point: one product, one cost basis, two reports.
            try {
                const pid = await seed197Shape(`${TAG}-F`, 203.3);
                const block = (await august(pid)).blocks[0];
                const card = await stockCardReport({
                    user: adminUser, dateFrom: "2026-08-01", dateTo: "2026-08-31",
                    shopId: SHOP_ID, productVariantId: pid,
                });
                const cardRows = card.products[0].rows;
                const closing = cardRows[cardRows.length - 1];

                expect(closing.cost_per_unit).toBeCloseTo(block.summary.final_avg_cost, 4);
                expect(closing.cost_per_unit).toBeCloseTo(203.3, 4);
                expect(cardRows[0].cost_per_unit).toBeCloseTo(block.rows[0].bal_avg_cost, 4);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );
});
