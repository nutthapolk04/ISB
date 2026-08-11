/**
 * Regression guard for the 2026-08-10 outage: the raw `INSERT INTO receipts`
 * in pos_checkout_service.ts had a column list of 22 names but a VALUES
 * clause with only 19 expressions and no closing paren before `RETURNING id`
 * — every single checkout (cash, wallet, EDC, department) failed with
 * `syntax error at or near "RETURNING"` until this was fixed.
 *
 * A column-count mismatch is loud (checkout() throws, nothing gets created),
 * so the existing tests already catch a full regression of that shape. What
 * they don't catch is a column *reordered* against its value — e.g.
 * `cash_received`/`spending_group_id`/`created_by`/`idempotency_key` swapped
 * with each other — which can insert successfully with the wrong value in
 * the wrong column. This test pins each of those four trailing columns to a
 * distinct, independently-checkable value from a single checkout() call, so
 * a reorder trips an assertion instead of shipping silently.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { receipts, receiptItems, users } from "@/db/schema";
import { checkout, type CheckoutInput } from "@/services/pos_checkout_service";
import { createTestShopProduct, deleteTestShopProduct } from "./wallet_test_fixtures";

const HAS_DB = !!process.env.DATABASE_URL;
let dbOk = false;
let cashierUserId = 0;

beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
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

function tag(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("checkout() — receipt row fields land in the right columns", () => {
    it.if(HAS_DB)(
        "a cash sale stores cash_received, created_by, and idempotency_key each in its own column",
        async () => {
            if (!dbOk) return;
            const product = await createTestShopProduct(`POSFIELDS-CASH-${tag()}`);
            const key = `test-idem-${tag()}`;
            let receiptId: number | null = null;
            try {
                const input: CheckoutInput = {
                    payment_method: "cash",
                    shop_id: product.shopId,
                    userId: cashierUserId,
                    cash_received: product.unitPrice,
                    idempotency_key: key,
                    items: [
                        {
                            product_variant_id: product.shopProductId,
                            quantity: 1,
                            unit_price: product.unitPrice,
                            discount: 0,
                        },
                    ],
                };
                const receipt = await checkout(input);
                receiptId = receipt.id;

                const [row] = await db.select().from(receipts).where(eq(receipts.id, receiptId));
                expect(row).toBeTruthy();
                // Each assertion targets one of the four trailing columns in the
                // INSERT's VALUES list — a swap between any pair fails here even
                // though the insert itself would still succeed.
                expect(Number(row.cashReceived)).toBeCloseTo(product.unitPrice, 2);
                expect(row.spendingGroupId).toBeNull();
                expect(row.createdBy).toBe(cashierUserId);
                expect(row.idempotencyKey).toBe(key);
            } finally {
                if (receiptId != null) {
                    await db.delete(receiptItems).where(eq(receiptItems.receiptId, receiptId));
                    await db.delete(receipts).where(eq(receipts.id, receiptId));
                }
                await deleteTestShopProduct(product.shopProductId);
            }
        },
        30_000,
    );

    it.if(HAS_DB)(
        "an EDC sale with no idempotency_key stores NULL there, not an empty string",
        async () => {
            if (!dbOk) return;
            const product = await createTestShopProduct(`POSFIELDS-EDC-${tag()}`);
            let receiptId: number | null = null;
            try {
                const input: CheckoutInput = {
                    payment_method: "edc",
                    shop_id: product.shopId,
                    userId: cashierUserId,
                    edc_approval_code: "TEST-APPR",
                    items: [
                        {
                            product_variant_id: product.shopProductId,
                            quantity: 1,
                            unit_price: product.unitPrice,
                            discount: 0,
                        },
                    ],
                };
                const receipt = await checkout(input);
                receiptId = receipt.id;

                const [row] = await db.select().from(receipts).where(eq(receipts.id, receiptId));
                expect(row.createdBy).toBe(cashierUserId);
                expect(row.cashReceived).toBeNull();
                expect(row.idempotencyKey).toBeNull();
            } finally {
                if (receiptId != null) {
                    await db.delete(receiptItems).where(eq(receiptItems.receiptId, receiptId));
                    await db.delete(receipts).where(eq(receipts.id, receiptId));
                }
                await deleteTestShopProduct(product.shopProductId);
            }
        },
        30_000,
    );
});
