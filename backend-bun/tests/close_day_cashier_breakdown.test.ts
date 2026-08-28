/**
 * "Today Sale" (canteen_service.ts::closeDay(), POST /canteen/:shopId/close-day)
 * per-cashier breakdown — real permission boundary, not UI polish:
 *
 *   - admin/manager callers see `cashier_breakdown` for every cashier who
 *     sold something in the shop today.
 *   - a plain "cashier" caller (no admin/manager role) only ever sees their
 *     own row, even though the backend computed everyone's — the filtering
 *     happens inside closeDay() itself, so there is no way to reconstruct
 *     another cashier's numbers from the response.
 *
 * Conventions mirror partial_return_active_sales.test.ts — localhost-only DB,
 * run-unique fixtures (a dedicated shop_id, since closeDay() always reads
 * real "today" in Asia/Bangkok and has no date-override parameter), FK-ordered
 * cleanup in `finally`.
 */
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { inArray } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { receipts, shops, users } from "@/db/schema";
import { closeDay } from "@/services/canteen_service";
import { bangkokTodayIso } from "@/lib/dates";

const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
const DB_TIMEOUT_MS = 45_000;

const TAG = `cdcb${Date.now().toString(36)}`;
const SHOP_ID = `cdcb-${TAG}`;

let cashierAId = 0;
let cashierBId = 0;
let idleCashierId = 0;
const userIds: number[] = [];
const receiptIds: number[] = [];

beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    }
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn(
            "[close_day_cashier_breakdown] Skipping DB-backed cases: DATABASE_URL is not localhost. " +
            "These tests write fixture rows and must not run against a shared database.",
        );
    }
    if (HAS_DB) {
        dbOk = await pingDb();
        if (dbOk) {
            await db.insert(shops).values({
                id: SHOP_ID,
                name: `Cashier breakdown fixture ${TAG}`,
                shopType: "avg_cost",
                isActive: true,
            });

            const [a] = await db.insert(users).values({
                username: `cashier-a-${TAG}`,
                email: `cashier-a-${TAG}@fixture.invalid`,
                fullName: `Cashier A ${TAG}`,
                hashedPassword: "x",
                isActive: true,
                isSuperuser: false,
                role: "cashier",
                externalId: `cashier-a-${TAG}`,
            }).returning({ id: users.id });
            cashierAId = a.id;
            userIds.push(a.id);

            const [b] = await db.insert(users).values({
                username: `cashier-b-${TAG}`,
                email: `cashier-b-${TAG}@fixture.invalid`,
                fullName: `Cashier B ${TAG}`,
                hashedPassword: "x",
                isActive: true,
                isSuperuser: false,
                role: "cashier",
                externalId: `cashier-b-${TAG}`,
            }).returning({ id: users.id });
            cashierBId = b.id;
            userIds.push(b.id);

            const [idle] = await db.insert(users).values({
                username: `cashier-idle-${TAG}`,
                email: `cashier-idle-${TAG}@fixture.invalid`,
                fullName: `Cashier Idle ${TAG}`,
                hashedPassword: "x",
                isActive: true,
                isSuperuser: false,
                role: "cashier",
                externalId: `cashier-idle-${TAG}`,
            }).returning({ id: users.id });
            idleCashierId = idle.id;
            userIds.push(idle.id);
        }
    }
});

afterAll(async () => {
    if (!dbOk) return;
    await db.delete(shops).where(inArray(shops.id, [SHOP_ID]));
    if (userIds.length) {
        await db.delete(users).where(inArray(users.id, userIds));
    }
});

async function seedReceipt(opts: { suffix: string; total: number; createdBy: number }): Promise<void> {
    const day = bangkokTodayIso();
    const [r] = await db
        .insert(receipts)
        .values({
            receiptNumber: `R-${TAG}-${opts.suffix}`,
            transactionDate: `${day}T10:00:00+07:00`,
            transactionMode: "SALE",
            shopId: SHOP_ID,
            subtotal: opts.total.toFixed(2),
            discount: "0.00",
            tax: "0.00",
            total: opts.total.toFixed(2),
            paymentMethod: "CASH",
            status: "ACTIVE",
            createdBy: opts.createdBy,
        })
        .returning({ id: receipts.id });
    receiptIds.push(r.id);
}

async function cleanupReceipts(): Promise<void> {
    if (receiptIds.length) {
        await db.delete(receipts).where(inArray(receipts.id, receiptIds));
        receiptIds.length = 0;
    }
}

describe("canteen_service.closeDay() — per-cashier breakdown permission boundary", () => {
    it.if(HAS_DB)(
        "admin caller sees every cashier's breakdown, correctly totalled",
        async () => {
            if (!dbOk) return;
            try {
                await seedReceipt({ suffix: "A1", total: 100, createdBy: cashierAId });
                await seedReceipt({ suffix: "A2", total: 50, createdBy: cashierAId });
                await seedReceipt({ suffix: "B1", total: 30, createdBy: cashierBId });

                const summary = await closeDay(SHOP_ID, { id: cashierAId, roles: ["admin"] });

                expect(summary.total_orders).toBe(3);
                expect(summary.total_revenue).toBeCloseTo(180, 2);
                expect(summary.cashier_breakdown).toHaveLength(2);

                const rowA = summary.cashier_breakdown.find((r) => r.cashier_id === cashierAId);
                const rowB = summary.cashier_breakdown.find((r) => r.cashier_id === cashierBId);
                expect(rowA).toBeDefined();
                expect(rowA!.total_orders).toBe(2);
                expect(rowA!.total_revenue).toBeCloseTo(150, 2);
                expect(rowA!.cashier_name).toContain(`Cashier A ${TAG}`);
                expect(rowB).toBeDefined();
                expect(rowB!.total_orders).toBe(1);
                expect(rowB!.total_revenue).toBeCloseTo(30, 2);
                expect(rowB!.cashier_name).toContain(`Cashier B ${TAG}`);
            } finally {
                await cleanupReceipts();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "manager caller also sees every cashier's breakdown",
        async () => {
            if (!dbOk) return;
            try {
                await seedReceipt({ suffix: "MGA", total: 40, createdBy: cashierAId });
                await seedReceipt({ suffix: "MGB", total: 60, createdBy: cashierBId });

                const summary = await closeDay(SHOP_ID, { id: cashierAId, roles: ["manager"] });

                expect(summary.cashier_breakdown).toHaveLength(2);
                expect(summary.cashier_breakdown.map((r) => r.cashier_id).sort()).toEqual(
                    [cashierAId, cashierBId].sort(),
                );
            } finally {
                await cleanupReceipts();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "plain cashier caller sees only their own row — never another cashier's name or amount",
        async () => {
            if (!dbOk) return;
            try {
                await seedReceipt({ suffix: "CA1", total: 70, createdBy: cashierAId });
                await seedReceipt({ suffix: "CB1", total: 999, createdBy: cashierBId });

                const summary = await closeDay(SHOP_ID, { id: cashierAId, roles: ["cashier"] });

                // Shop-wide totals are unaffected by the caller's role.
                expect(summary.total_orders).toBe(2);
                expect(summary.total_revenue).toBeCloseTo(1069, 2);

                // Breakdown is filtered down to exactly the caller's own row.
                expect(summary.cashier_breakdown).toHaveLength(1);
                expect(summary.cashier_breakdown[0].cashier_id).toBe(cashierAId);
                expect(summary.cashier_breakdown[0].total_revenue).toBeCloseTo(70, 2);

                // Explicitly assert cashier B's identity/amount never leaked out.
                const serialized = JSON.stringify(summary.cashier_breakdown);
                expect(serialized).not.toContain(String(cashierBId));
                expect(serialized).not.toContain("Cashier B");
                expect(serialized).not.toContain("999");
            } finally {
                await cleanupReceipts();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "a cashier with no sales today gets an empty breakdown, not a zeroed fake row",
        async () => {
            if (!dbOk) return;
            try {
                // Someone else in the shop did sell today, so totalOrders > 0
                // and we exercise the real filter path (not the early-exit).
                await seedReceipt({ suffix: "OTH", total: 25, createdBy: cashierAId });

                const summary = await closeDay(SHOP_ID, { id: idleCashierId, roles: ["cashier"] });

                expect(summary.total_orders).toBe(1);
                expect(summary.cashier_breakdown).toEqual([]);
            } finally {
                await cleanupReceipts();
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "no orders at all today → cashier_breakdown is [] via the early-exit path",
        async () => {
            if (!dbOk) return;
            const summary = await closeDay(SHOP_ID, { id: cashierAId, roles: ["admin"] });
            expect(summary.total_orders).toBe(0);
            expect(summary.cashier_breakdown).toEqual([]);
        },
        DB_TIMEOUT_MS,
    );
});
