/**
 * Import — the opening cost basis of a brand-new product.
 *
 * `avg_cost` was hard-coded to "0.0000" on insert and is only ever set later by
 * receiveStock(), which the import skips when a row's stock is 0. So a
 * catalog-only row — stock 0 with the cost columns filled in — landed with
 * avg_cost = 0 and stayed there.
 *
 * That is the origin of the ฿221.5804 incident: product 197 came in that way,
 * sold 33 units costed at ฿0 (driving stock to -33), and its first real
 * delivery of 400 @ ฿203.30 then had to spread the whole ฿81,320 across the 367
 * units left — 81,320 / 367 = 221.5804. Every symptom downstream traced back to
 * one hard-coded zero.
 *
 * `cost_per_unit` is the delivery-cost column in the template and is what
 * receiveStock() would have used, so it wins; `internal_price` is the fallback.
 *
 * NOTE the last test: seeding the column does NOT make the Stock Card / Balance
 * File reports agree, because they replay shop_movements from {qty:0, avg:0} and
 * only a `receive` row moves the average. That gap is pinned here deliberately
 * so it can't be mistaken for fixed.
 *
 * Conventions mirror the other DB-backed suites: localhost-only, run-unique
 * fixtures, cleaned up in `finally`.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import * as XLSX from "xlsx";
import { eq, inArray, like } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { shopProducts, shopMovements } from "@/db/schema";
import { importStore } from "@/services/admin_import_service";
import { getBalanceFile } from "@/services/balance_file_service";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";

const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
const DB_TIMEOUT_MS = 45_000;

const SHOP_ID = "S0001";
const TAG = `imp-${Date.now().toString(36)}`;
const admin = {
    sub: "1", roles: ["admin"], is_superuser: true, shop_id: null,
} as unknown as AccessTokenPayload & { shop_id?: string | null };

beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    }
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn(
            "[import_opening_avg_cost] Skipping DB-backed cases: DATABASE_URL is not localhost. " +
            "These tests write fixture rows and must not run against a shared database.",
        );
    }
    if (HAS_DB) dbOk = await pingDb();
});

type SheetRow = Record<string, string | number | null>;

/** A one-sheet workbook in the same shape as the downloadable template. */
function workbook(rows: SheetRow[]): File {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Store");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new File([new Uint8Array(buf)], "import.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
}

const baseRow = (code: string): SheetRow => ({
    product_code: code,
    product_name: `${code} fixture`,
    barcode: null,
    external_price: 255,
    internal_price: 180,
    category: "TEST",
    uom: null,
    shop_id: SHOP_ID,
    stock: 0,
    cost_per_unit: null,
    notes: null,
    reference: null,
});

async function importRows(rows: SheetRow[]) {
    const res = await importStore({ caller: admin, file: workbook(rows), shopId: SHOP_ID });
    expect(res.status).toBe(200);
    return res.body as { products: { created: number; errors: unknown[] }; stock: { imported: number; errors: unknown[] } };
}

const productByCode = async (code: string) => {
    const [p] = await db.select().from(shopProducts)
        .where(eq(shopProducts.productCode, code)).limit(1);
    return p;
};

async function cleanup(): Promise<void> {
    const rows = await db.select({ id: shopProducts.id }).from(shopProducts)
        .where(like(shopProducts.productCode, `${TAG}%`));
    const ids = rows.map((r) => r.id);
    if (ids.length) {
        await db.delete(shopMovements).where(inArray(shopMovements.productId, ids));
        await db.delete(shopProducts).where(inArray(shopProducts.id, ids));
    }
}

describe("importStore — opening avg_cost", () => {
    it.if(HAS_DB)(
        "seeds avg_cost from cost_per_unit even when stock is 0",
        async () => {
            if (!dbOk) return;
            // The exact shape that produced product 197: catalog row, no stock,
            // cost filled in. It used to land with avg_cost = 0.0000.
            try {
                const code = `${TAG}-A`;
                await importRows([{ ...baseRow(code), stock: 0, cost_per_unit: 203.3 }]);

                const p = await productByCode(code);
                expect(p).toBeDefined();
                expect(p.stock).toBe(0);
                expect(Number(p.avgCost)).toBeCloseTo(203.3, 4);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "falls back to internal_price when cost_per_unit is blank",
        async () => {
            if (!dbOk) return;
            // Catalog-only rows in the canteen template have no cost_per_unit
            // column at all, so the cost still has to come from somewhere.
            try {
                const code = `${TAG}-B`;
                await importRows([{ ...baseRow(code), stock: 0, internal_price: 180, cost_per_unit: null }]);

                const p = await productByCode(code);
                expect(Number(p.avgCost)).toBeCloseTo(180, 4);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "leaves the stock > 0 path exactly as it was",
        async () => {
            if (!dbOk) return;
            // With stock the import calls receiveStock(), which recomputes
            // avg_cost from stock_before = 0 — so the seed is irrelevant there
            // and must not change the answer.
            try {
                const code = `${TAG}-C`;
                const res = await importRows([{ ...baseRow(code), stock: 50, cost_per_unit: 65 }]);
                expect(res.stock.imported).toBe(1);

                const p = await productByCode(code);
                expect(p.stock).toBe(50);
                expect(Number(p.avgCost)).toBeCloseTo(65, 4);

                // …and it produced a real receive movement, unlike the stock-0 row.
                const moves = await db.select().from(shopMovements).where(eq(shopMovements.productId, p.id));
                expect(moves).toHaveLength(1);
                expect(moves[0].type).toBe("receive");
                expect(Number(moves[0].costPerUnit)).toBeCloseTo(65, 4);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "does not touch avg_cost when the product already exists",
        async () => {
            if (!dbOk) return;
            // Re-importing a catalog must not silently reset a cost basis that
            // real deliveries have already moved.
            try {
                const code = `${TAG}-D`;
                await importRows([{ ...baseRow(code), stock: 40, cost_per_unit: 100 }]);
                const before = await productByCode(code);
                expect(Number(before.avgCost)).toBeCloseTo(100, 4);

                // Same product, different cost column, no stock this time.
                await importRows([{ ...baseRow(code), stock: 0, cost_per_unit: 999 }]);
                const after = await productByCode(code);
                expect(Number(after.avgCost)).toBeCloseTo(100, 4);   // unchanged
                expect(Number(after.internalPrice)).toBeCloseTo(180, 2); // this one does update
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "carries the seeded cost through to the reports",
        async () => {
            if (!dbOk) return;
            // The seeded column alone was only half the fix: Balance File
            // rebuilds the average from shop_movements starting at
            // {qty:0, avg:0} and only a `receive` row moves it, so a stock-0
            // import — which writes no movement at all — left the report
            // valuing everything at ฿0 while the product row said 203.30.
            //
            // balance_file_service.ts now falls back to the product's avg_cost
            // when there is no prior history, the same way Stock Card always
            // has. This test is what keeps the two halves connected: seeding the
            // column has to be visible where the money is actually reported.
            try {
                const code = `${TAG}-E`;
                await importRows([{ ...baseRow(code), stock: 0, cost_per_unit: 203.3 }]);
                const p = await productByCode(code);

                expect(Number(p.avgCost)).toBeCloseTo(203.3, 4);
                // Still no movement — the stock really is 0, nothing was received.
                const moves = await db.select().from(shopMovements).where(eq(shopMovements.productId, p.id));
                expect(moves).toHaveLength(0);

                const opening = (await getBalanceFile(SHOP_ID, 2026, 8, p.id)).blocks[0]?.rows[0];
                expect(opening?.bal_avg_cost).toBeCloseTo(203.3, 4);
            } finally {
                await cleanup();
            }
        },
        DB_TIMEOUT_MS,
    );
});
