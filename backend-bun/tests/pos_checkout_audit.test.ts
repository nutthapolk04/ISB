/**
 * Coverage for the failed-checkout audit trail: before this, a checkout()
 * attempt that never became a receipt (bad product id, insufficient wallet
 * balance, network blip mid-request, etc.) left zero trace anywhere except a
 * toast the cashier saw once — cash/wallet/department sales had no
 * "attempt" record at all (unlike EDC/QR, which have their own telemetry).
 * checkout() now logs every failure to the existing audit_logs table
 * (action='REJECT', an enum value that existed but was never used) so it
 * shows up in the same admin Audit Log screen as successful sales.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { and, desc, eq } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { auditLogs, receiptItems, receipts, users } from "@/db/schema";
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

async function latestReject(shopId: string) {
    const rows = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "REJECT"), eq(auditLogs.shopId, shopId)))
        .orderBy(desc(auditLogs.id))
        .limit(1);
    return rows[0];
}

async function countRejects(shopId: string): Promise<number> {
    const rows = await db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "REJECT"), eq(auditLogs.shopId, shopId)));
    return rows.length;
}

describe("checkout() — failed attempts are logged to audit_logs (2026-08-10)", () => {
    it.if(HAS_DB)(
        "a checkout that fails (product not found) is recorded as REJECT with the reason",
        async () => {
            if (!dbOk) return;
            const shopTag = `POSCK-FAIL-${tag()}`;
            // A throwaway shop_id string is enough — the error fires before
            // any shop lookup is required to succeed for this failure mode.
            const shopId = shopTag;
            const before = await countRejects(shopId);

            const input: CheckoutInput = {
                payment_method: "cash",
                shop_id: shopId,
                userId: cashierUserId,
                items: [{ product_variant_id: -424_242, quantity: 1, unit_price: 100, discount: 0 }],
            };

            await expect(checkout(input)).rejects.toThrow(/not found/);

            try {
                const after = await countRejects(shopId);
                expect(after).toBe(before + 1);

                const row = await latestReject(shopId);
                expect(row?.entityType).toBe("receipt");
                expect(row?.entityId).toBeNull();
                expect(row?.userId).toBe(cashierUserId);
                const changes = row?.changesJson as Record<string, unknown> | null;
                expect(changes?.payment_method).toBe("cash");
                expect(String(changes?.reason ?? "")).toMatch(/not found/);
            } finally {
                await db.delete(auditLogs).where(and(eq(auditLogs.action, "REJECT"), eq(auditLogs.shopId, shopId)));
            }
        },
        30_000,
    );

    it.if(HAS_DB)(
        "a successful checkout does NOT create a REJECT row",
        async () => {
            if (!dbOk) return;
            const product = await createTestShopProduct(`POSCK-OK-${tag()}`);
            const before = await countRejects(product.shopId);
            let receiptId: number | null = null;
            try {
                const input: CheckoutInput = {
                    payment_method: "cash",
                    shop_id: product.shopId,
                    userId: cashierUserId,
                    cash_received: product.unitPrice,
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
                expect(receipt.id).toBeGreaterThan(0);

                const after = await countRejects(product.shopId);
                expect(after).toBe(before);
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
        "a fast validation failure (before any DB work) is still logged",
        async () => {
            if (!dbOk) return;
            const shopId = `POSCK-VALID-${tag()}`;
            const before = await countRejects(shopId);

            const input: CheckoutInput = {
                payment_method: "not-a-real-method",
                shop_id: shopId,
                userId: cashierUserId,
                items: [{ product_variant_id: 1, quantity: 1, unit_price: 100, discount: 0 }],
            };

            await expect(checkout(input)).rejects.toThrow(/Invalid payment_method/);

            try {
                const after = await countRejects(shopId);
                expect(after).toBe(before + 1);
                const row = await latestReject(shopId);
                expect(String((row?.changesJson as Record<string, unknown> | null)?.reason ?? "")).toMatch(
                    /Invalid payment_method/,
                );
            } finally {
                await db.delete(auditLogs).where(and(eq(auditLogs.action, "REJECT"), eq(auditLogs.shopId, shopId)));
            }
        },
        30_000,
    );
});
