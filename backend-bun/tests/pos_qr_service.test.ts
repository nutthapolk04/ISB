/**
 * Regression coverage for the 2026-08-10 incident (ref=POS-20260810-2H13YJ):
 * a Store bundle sale paid via Thai QR stored `product_variant_id: -3` in the
 * intent's cart_snapshot (the frontend half of this bug, fixed in
 * Store.tsx/buildCheckoutItem.ts). When the BAY webhook then called
 * confirmPosQrSale, checkout() threw "Product id=-3 not found" — but Phase A's
 * claim (`confirmed_via = 'gateway_webhook_claimed'`) had already committed
 * and nothing released it on failure, so the intent got stuck forever: money
 * captured by BAY, no receipt ever created, and every future call (webhook
 * retry, /inquiry, "Check Now") skipped without retrying.
 *
 * These tests cover the backend half of the fix: a checkout() failure must
 * release the claim (to a distinct 'gateway_webhook_failed' sentinel) so a
 * later call can retry, while the happy path stays idempotent.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { paymentIntents, receipts, receiptItems, users } from "@/db/schema";
import { confirmPosQrSale } from "@/services/pos_qr_service";
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
            if (!rows[0]) throw new Error("No users row — seed DB before running pos_qr_service tests");
            cashierUserId = rows[0].id;
        }
    }
});

function tag(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertPosSaleIntent(args: {
    refCode: string;
    amount: number;
    cartSnapshot: unknown;
}): Promise<number> {
    const [row] = await db
        .insert(paymentIntents)
        .values({
            refCode: args.refCode,
            walletId: null,
            amount: String(args.amount),
            qrPayload: `test://${args.refCode}`,
            status: "pending",
            paymentMethod: "bay_qr",
            createdBy: cashierUserId,
            intentType: "pos_sale",
            cartSnapshot: args.cartSnapshot as Record<string, unknown>,
        })
        .returning({ id: paymentIntents.id });
    return row.id;
}

async function getIntent(refCode: string) {
    const rows = await db
        .select({
            status: paymentIntents.status,
            confirmedVia: paymentIntents.confirmedVia,
            receiptId: paymentIntents.receiptId,
        })
        .from(paymentIntents)
        .where(eq(paymentIntents.refCode, refCode))
        .limit(1);
    return rows[0];
}

async function cleanupIntent(refCode: string, receiptId: number | null): Promise<void> {
    if (receiptId != null) {
        await db.delete(receiptItems).where(eq(receiptItems.receiptId, receiptId));
        await db.delete(receipts).where(eq(receipts.id, receiptId));
    }
    await db.delete(paymentIntents).where(eq(paymentIntents.refCode, refCode));
}

describe("confirmPosQrSale — webhook-confirm claim/retry (2026-08-10 incident)", () => {
    it.if(HAS_DB)(
        "a valid cart confirms successfully, and a duplicate call is idempotent",
        async () => {
            if (!dbOk) return;
            const product = await createTestShopProduct(`POSQR-OK-${tag()}`);
            const refCode = `TEST-POSQR-OK-${tag()}`;
            let receiptId: number | null = null;
            try {
                await insertPosSaleIntent({
                    refCode,
                    amount: product.unitPrice,
                    cartSnapshot: {
                        shop_id: product.shopId,
                        items: [
                            {
                                product_variant_id: product.shopProductId,
                                quantity: 1,
                                unit_price: product.unitPrice,
                                discount: 0,
                            },
                        ],
                    },
                });

                const first = await confirmPosQrSale(refCode);
                expect(first).not.toBeNull();
                receiptId = first;

                // Duplicate webhook delivery / inquiry poll on an already-
                // confirmed intent must return the same receipt, not create
                // a second one.
                const second = await confirmPosQrSale(refCode);
                expect(second).toBe(first);

                const intent = await getIntent(refCode);
                expect(intent?.status).toBe("confirmed");
                expect(intent?.confirmedVia).toBe("gateway_webhook");
                expect(intent?.receiptId).toBe(first);
            } finally {
                await cleanupIntent(refCode, receiptId);
                await deleteTestShopProduct(product.shopProductId);
            }
        },
        30_000,
    );

    it.if(HAS_DB)(
        "checkout() failure releases the claim instead of orphaning the payment forever",
        async () => {
            if (!dbOk) return;
            const product = await createTestShopProduct(`POSQR-FAIL-${tag()}`);
            const refCode = `TEST-POSQR-FAIL-${tag()}`;
            try {
                // Reproduces the exact incident shape: a bundle's synthetic
                // negative id leaking into product_variant_id, so checkout()
                // can't find any such row.
                await insertPosSaleIntent({
                    refCode,
                    amount: 100,
                    cartSnapshot: {
                        shop_id: product.shopId,
                        items: [{ product_variant_id: -3, quantity: 1, unit_price: 100, discount: 0 }],
                    },
                });

                await expect(confirmPosQrSale(refCode)).rejects.toThrow(/Product id=-3 not found/);

                // Before the fix this stuck at 'gateway_webhook_claimed'
                // forever — every future call (webhook retry, /inquiry,
                // "Check Now") skipped without ever retrying checkout().
                const afterFailure = await getIntent(refCode);
                expect(afterFailure?.confirmedVia).toBe("gateway_webhook_failed");
                expect(afterFailure?.receiptId).toBeNull();
                expect(afterFailure?.status).toBe("pending");

                // A retry right after must NOT be silently skipped — it
                // should attempt checkout() again (and fail again on the
                // same still-bad snapshot), proving the claim was genuinely
                // released rather than the call short-circuiting.
                await expect(confirmPosQrSale(refCode)).rejects.toThrow(/Product id=-3 not found/);
                expect((await getIntent(refCode))?.confirmedVia).toBe("gateway_webhook_failed");
            } finally {
                await db.delete(paymentIntents).where(eq(paymentIntents.refCode, refCode));
                await deleteTestShopProduct(product.shopProductId);
            }
        },
        30_000,
    );

    it.if(HAS_DB)(
        "a corrected retry after a released claim succeeds and produces a receipt",
        async () => {
            if (!dbOk) return;
            const product = await createTestShopProduct(`POSQR-RETRY-${tag()}`);
            const refCode = `TEST-POSQR-RETRY-${tag()}`;
            let receiptId: number | null = null;
            try {
                const intentId = await insertPosSaleIntent({
                    refCode,
                    amount: 100,
                    cartSnapshot: {
                        shop_id: product.shopId,
                        items: [{ product_variant_id: -999_999, quantity: 1, unit_price: 100, discount: 0 }],
                    },
                });

                await expect(confirmPosQrSale(refCode)).rejects.toThrow(/not found/);
                expect((await getIntent(refCode))?.confirmedVia).toBe("gateway_webhook_failed");

                // Simulate the underlying bug getting fixed (e.g. the
                // frontend no longer sends a bad id) before BAY's next
                // webhook redelivery / the cashier's next "Check Now".
                await db
                    .update(paymentIntents)
                    .set({
                        cartSnapshot: {
                            shop_id: product.shopId,
                            items: [
                                {
                                    product_variant_id: product.shopProductId,
                                    quantity: 1,
                                    unit_price: product.unitPrice,
                                    discount: 0,
                                },
                            ],
                        },
                    })
                    .where(eq(paymentIntents.id, intentId));

                const retried = await confirmPosQrSale(refCode);
                expect(retried).not.toBeNull();
                receiptId = retried;

                const intent = await getIntent(refCode);
                expect(intent?.status).toBe("confirmed");
                expect(intent?.confirmedVia).toBe("gateway_webhook");
                expect(intent?.receiptId).toBe(retried);
            } finally {
                await cleanupIntent(refCode, receiptId);
                await deleteTestShopProduct(product.shopProductId);
            }
        },
        30_000,
    );
});
