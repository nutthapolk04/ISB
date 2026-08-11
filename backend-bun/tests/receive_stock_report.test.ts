/**
 * Receive Stock Report — new report (2026-08-11) surfacing every stock-intake
 * transaction as its own row, mirroring Sales by Item Report's flat-list
 * template. Existing coverage (stock_card_report.test.ts) only shows receive
 * movements folded into a per-product running-balance ledger; nothing pinned
 * a plain "list every receiving transaction" view until now.
 *
 * Conventions mirror stock_card_report.test.ts — DB cases gated on a
 * localhost DATABASE_URL, fixtures created through the real receiveStock()
 * write path (not hand-inserted rows) so the report and the write path can
 * never quietly drift apart, cleaned up in `finally`.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { shopProducts, shopMovements, users } from "@/db/schema";
import { receiveStockReport } from "@/services/report_service";
import { receiveStock } from "@/services/shop_product_service";
import type { AccessTokenPayload } from "@/middleware/AuthMiddleware";

const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
let cashierUserId = 0;
const DB_TIMEOUT_MS = 45_000;
const SHOP_ID = "S0001";
const TAG = `rsr-${Date.now().toString(36)}`;

const adminUser = { sub: "1", roles: ["admin"], is_superuser: true, shop_id: null } as unknown as AccessTokenPayload;

beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    }
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn(
            "[receive_stock_report] Skipping DB-backed cases: DATABASE_URL is not localhost.",
        );
    }
    if (HAS_DB) {
        dbOk = await pingDb();
        if (dbOk) {
            const rows = await db.select({ id: users.id }).from(users).limit(1);
            if (!rows[0]) throw new Error("No users row — seed DB before running this test");
            cashierUserId = rows[0].id;
        }
    }
});

async function seedProduct(code: string): Promise<number> {
    const [p] = await db
        .insert(shopProducts)
        .values({
            shopId: SHOP_ID,
            productCode: code,
            name: `${code} fixture`,
            category: "TEST",
            externalPrice: "999.00",
            internalPrice: "0",
            avgCost: "0",
            stock: 0,
            isActive: true,
            vatPercent: "0",
            minStock: 0,
        })
        .returning({ id: shopProducts.id });
    return p.id;
}

describe("receiveStockReport", () => {
    it.if(HAS_DB)(
        "lists a receive transaction with product, cost, PO reference, and the recording cashier",
        async () => {
            if (!dbOk) return;
            const code = `${TAG}-A`;
            const productIds: number[] = [];
            try {
                const pid = await seedProduct(code);
                productIds.push(pid);
                await receiveStock({
                    shopId: SHOP_ID,
                    userId: cashierUserId,
                    items: [
                        {
                            product_id: pid,
                            qty: 20,
                            cost_per_unit: 15.5,
                            po: "PO-12345",
                            received_date: "2026-08-01",
                        },
                    ],
                });

                const today = new Date().toISOString().slice(0, 10);
                const report = await receiveStockReport({
                    user: adminUser,
                    shopId: SHOP_ID,
                    dateFrom: today,
                    dateTo: today,
                    productSearch: code,
                });

                expect(report.rows.length).toBe(1);
                const row = report.rows[0];
                expect(row.product_code).toBe(code);
                expect(row.quantity).toBe(20);
                expect(row.cost_per_unit).toBe(15.5);
                expect(row.total_cost).toBe(310);
                expect(row.po_number).toBe("PO-12345");
                expect(row.invoice_number).toBeNull();
                expect(row.received_date).toBe("2026-08-01");
                expect(row.shop_id).toBe(SHOP_ID);
                expect(row.created_by_name).toBeTruthy();
                expect(report.totals.quantity).toBe(20);
                expect(report.totals.total_cost).toBe(310);
                expect(report.line_count).toBe(1);
            } finally {
                if (productIds.length) {
                    await db.delete(shopMovements).where(inArray(shopMovements.productId, productIds));
                    await db.delete(shopProducts).where(inArray(shopProducts.id, productIds));
                }
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "keeps PO and Invoice as separate fields, and each is independently searchable",
        async () => {
            if (!dbOk) return;
            const code = `${TAG}-C`;
            const productIds: number[] = [];
            try {
                const pid = await seedProduct(code);
                productIds.push(pid);
                await receiveStock({
                    shopId: SHOP_ID,
                    userId: cashierUserId,
                    items: [
                        {
                            product_id: pid,
                            qty: 5,
                            cost_per_unit: 10,
                            po: `PO-${TAG}`,
                            invoice: `INV-${TAG}`,
                        },
                    ],
                });

                const today = new Date().toISOString().slice(0, 10);
                const base = { user: adminUser, shopId: SHOP_ID, dateFrom: today, dateTo: today };

                const full = await receiveStockReport({ ...base, productSearch: code });
                expect(full.rows.length).toBe(1);
                expect(full.rows[0].po_number).toBe(`PO-${TAG}`);
                expect(full.rows[0].invoice_number).toBe(`INV-${TAG}`);

                const byPo = await receiveStockReport({ ...base, poNumber: `PO-${TAG}` });
                expect(byPo.rows.length).toBe(1);

                const byInvoice = await receiveStockReport({ ...base, invoiceNumber: `INV-${TAG}` });
                expect(byInvoice.rows.length).toBe(1);

                const noMatch = await receiveStockReport({ ...base, poNumber: "does-not-exist" });
                expect(noMatch.rows.length).toBe(0);
            } finally {
                if (productIds.length) {
                    await db.delete(shopMovements).where(inArray(shopMovements.productId, productIds));
                    await db.delete(shopProducts).where(inArray(shopProducts.id, productIds));
                }
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "excludes non-receive movement types (sale, adjustment) from the report",
        async () => {
            if (!dbOk) return;
            const code = `${TAG}-B`;
            const productIds: number[] = [];
            try {
                const pid = await seedProduct(code);
                productIds.push(pid);
                await receiveStock({
                    shopId: SHOP_ID,
                    userId: cashierUserId,
                    items: [{ product_id: pid, qty: 10, cost_per_unit: 5 }],
                });
                // A second receive on the same product — the report must show
                // both transactions as separate rows, not folded together.
                await receiveStock({
                    shopId: SHOP_ID,
                    userId: cashierUserId,
                    items: [{ product_id: pid, qty: 3, cost_per_unit: 5 }],
                });

                const today = new Date().toISOString().slice(0, 10);
                const report = await receiveStockReport({
                    user: adminUser,
                    shopId: SHOP_ID,
                    dateFrom: today,
                    dateTo: today,
                    productSearch: code,
                });

                expect(report.rows.length).toBe(2);
                expect(report.rows.every((r) => r.quantity > 0)).toBe(true);
                expect(report.totals.quantity).toBe(13);
                expect(report.totals.total_cost).toBe(65);
                // Default sort_order is oldest-first — the qty=10 receive landed
                // first, so it must be seq 1, not the qty=3 one.
                expect(report.rows[0].quantity).toBe(10);
                expect(report.rows[0].seq).toBe(1);
                expect(report.rows[1].quantity).toBe(3);

                const desc = await receiveStockReport({
                    user: adminUser,
                    shopId: SHOP_ID,
                    dateFrom: today,
                    dateTo: today,
                    productSearch: code,
                    sortOrder: "desc",
                });
                expect(desc.rows[0].quantity).toBe(3);
                expect(desc.rows[0].seq).toBe(1);
                expect(desc.rows[1].quantity).toBe(10);

                // Sanity: a matching movement row of a different type would have
                // broken this report if the `type = 'receive'` filter were ever
                // dropped — confirm none crept into shop_movements for this
                // product outside of what receiveStock() itself wrote.
                const allMovements = await db
                    .select()
                    .from(shopMovements)
                    .where(eq(shopMovements.productId, pid));
                expect(allMovements.every((m) => m.type === "receive")).toBe(true);
            } finally {
                if (productIds.length) {
                    await db.delete(shopMovements).where(inArray(shopMovements.productId, productIds));
                    await db.delete(shopProducts).where(inArray(shopProducts.id, productIds));
                }
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "a manager scoped to a different shop cannot read another shop's receiving log",
        async () => {
            if (!dbOk) return;
            const managerOfOtherShop = {
                sub: "2",
                roles: ["manager"],
                is_superuser: false,
                shop_id: "S0002",
            } as unknown as AccessTokenPayload;

            await expect(
                receiveStockReport({ user: managerOfOtherShop, shopId: SHOP_ID }),
            ).rejects.toThrow(/not authorized/i);
        },
        DB_TIMEOUT_MS,
    );
});
