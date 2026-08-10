/**
 * Coverage for the POS Transaction Log feature: `pos_checkout_transactions`
 * records every checkout attempt — from the moment a payment method is
 * picked and confirmed — through to its final status
 * (pending → success/failed/cancelled), surfaced as the "Transactions" tab
 * on the Store/Canteen Receipts pages. Distinct from `receipts` (completed
 * sales only), `payment_intents` (QR only), and `edc_txn_events` (EDC only).
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { desc, eq } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { paymentIntents, posCheckoutTransactions, productBundles, receiptItems, receipts, users } from "@/db/schema";
import { checkout, type CheckoutInput } from "@/services/pos_checkout_service";
import { confirmPosQrSale, cancelPosQrIntent } from "@/services/pos_qr_service";
import type { AccessTokenPayload } from "@/utils/AuthUtils";
import {
    startTransaction,
    listTransactions,
    getTransactionIdByRefCode,
    getTransactionDetail,
} from "@/services/pos_transaction_service";
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

async function getTxnByRefCode(refCode: string) {
    const rows = await db
        .select()
        .from(posCheckoutTransactions)
        .where(eq(posCheckoutTransactions.refCode, refCode))
        .orderBy(desc(posCheckoutTransactions.id));
    return rows;
}

const caller: AccessTokenPayload = {
    sub: "0",
    username: "test",
    email: "test@example.com",
    roles: ["admin"],
    is_superuser: true,
    shop_id: null,
    shop_module: null,
    family_code: null,
    exp: 0,
    type: "access",
};

describe("pos_checkout_transactions — direct checkout (cash/wallet/EDC/department)", () => {
    it.if(HAS_DB)(
        "a successful checkout produces a 'success' row linked to the receipt",
        async () => {
            if (!dbOk) return;
            const product = await createTestShopProduct(`POSTXN-OK-${tag()}`);
            let receiptId: number | null = null;
            let txnId: number | null = null;
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

                const rows = await db
                    .select()
                    .from(posCheckoutTransactions)
                    .where(eq(posCheckoutTransactions.receiptId, receiptId))
                    .orderBy(desc(posCheckoutTransactions.id))
                    .limit(1);
                const row = rows[0];
                txnId = row?.id ?? null;
                expect(row).toBeTruthy();
                expect(row?.status).toBe("success");
                expect(row?.paymentMethod).toBe("cash");
                expect(row?.cashierUserId).toBe(cashierUserId);
                expect(Number(row?.amount)).toBeCloseTo(product.unitPrice, 2);
                expect(row?.resolvedAt).toBeTruthy();
            } finally {
                if (txnId != null) await db.delete(posCheckoutTransactions).where(eq(posCheckoutTransactions.id, txnId));
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
        "a failed checkout produces a 'failed' row with the error message",
        async () => {
            if (!dbOk) return;
            const shopId = `POSTXN-FAIL-${tag()}`;
            const before = await db
                .select({ id: posCheckoutTransactions.id })
                .from(posCheckoutTransactions)
                .where(eq(posCheckoutTransactions.shopId, shopId));

            const input: CheckoutInput = {
                payment_method: "cash",
                shop_id: shopId,
                userId: cashierUserId,
                items: [{ product_variant_id: -777_777, quantity: 1, unit_price: 100, discount: 0 }],
            };

            await expect(checkout(input)).rejects.toThrow(/not found/);

            try {
                const rows = await db
                    .select()
                    .from(posCheckoutTransactions)
                    .where(eq(posCheckoutTransactions.shopId, shopId))
                    .orderBy(desc(posCheckoutTransactions.id));
                expect(rows.length).toBe(before.length + 1);
                const row = rows[0];
                expect(row.status).toBe("failed");
                expect(row.errorMessage).toMatch(/not found/);
                expect(row.receiptId).toBeNull();
                expect(row.resolvedAt).toBeTruthy();
            } finally {
                await db.delete(posCheckoutTransactions).where(eq(posCheckoutTransactions.shopId, shopId));
            }
        },
        30_000,
    );
});

describe("pos_checkout_transactions — QR lifecycle (linked by ref_code)", () => {
    it.if(HAS_DB)(
        "confirmPosQrSale updates the SAME row created at intent time, not a second one",
        async () => {
            if (!dbOk) return;
            const product = await createTestShopProduct(`POSTXN-QR-${tag()}`);
            const refCode = `TEST-POSTXN-QR-${tag()}`;
            let receiptId: number | null = null;
            try {
                // Simulates what createPosQrIntent does: seed the payment_intents
                // row plus the pos_checkout_transactions row at intent-creation
                // time (the "picked QR and confirmed" moment), without needing a
                // live BAY gateway connection for this test.
                await db.insert(paymentIntents).values({
                    refCode,
                    walletId: null,
                    amount: String(product.unitPrice),
                    qrPayload: "test://qr",
                    status: "pending",
                    paymentMethod: "bay_qr",
                    createdBy: cashierUserId,
                    intentType: "pos_sale",
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
                const seededTxnIdRaw = await startTransaction({
                    refCode,
                    paymentMethod: "bay_qr",
                    shopId: product.shopId,
                    cashierUserId,
                    itemsCount: 1,
                    amount: product.unitPrice,
                });
                expect(seededTxnIdRaw).not.toBeNull();
                const seededTxnId = seededTxnIdRaw as number;

                const rowsBefore = await getTxnByRefCode(refCode);
                expect(rowsBefore.length).toBe(1);
                expect(rowsBefore[0].status).toBe("pending");

                const receiptIdFromConfirm = await confirmPosQrSale(refCode);
                expect(receiptIdFromConfirm).not.toBeNull();
                receiptId = receiptIdFromConfirm;

                const rowsAfter = await getTxnByRefCode(refCode);
                // Still exactly one row for this ref_code — confirmPosQrSale
                // updated it in place rather than creating a second one.
                expect(rowsAfter.length).toBe(1);
                expect(rowsAfter[0].id).toBe(seededTxnId);
                expect(rowsAfter[0].status).toBe("success");
                expect(rowsAfter[0].receiptId).toBe(receiptId);

                const linkedId = await getTransactionIdByRefCode(refCode);
                expect(linkedId).toBe(seededTxnId);
            } finally {
                await db.delete(posCheckoutTransactions).where(eq(posCheckoutTransactions.refCode, refCode));
                await db.delete(paymentIntents).where(eq(paymentIntents.refCode, refCode));
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
        "cancelPosQrIntent flips the transaction row to 'cancelled' — cart items stay visible after cancel",
        async () => {
            if (!dbOk) return;
            const product = await createTestShopProduct(`POSTXN-CANCEL-${tag()}`);
            const refCode = `TEST-POSTXN-CANCEL-${tag()}`;
            try {
                await db.insert(paymentIntents).values({
                    refCode,
                    walletId: null,
                    amount: String(product.unitPrice),
                    qrPayload: "test://qr",
                    status: "pending",
                    paymentMethod: "bay_qr",
                    createdBy: cashierUserId,
                    intentType: "pos_sale",
                    cartSnapshot: {
                        shop_id: product.shopId,
                        items: [
                            { product_variant_id: product.shopProductId, quantity: 1, unit_price: product.unitPrice },
                        ],
                    },
                });
                await startTransaction({
                    refCode,
                    paymentMethod: "bay_qr",
                    shopId: product.shopId,
                    cashierUserId,
                    itemsCount: 1,
                    amount: product.unitPrice,
                    items: [
                        { product_variant_id: product.shopProductId, quantity: 1, unit_price: product.unitPrice },
                    ],
                });

                await cancelPosQrIntent(refCode);

                const rows = await getTxnByRefCode(refCode);
                expect(rows.length).toBe(1);
                expect(rows[0].status).toBe("cancelled");
                expect(rows[0].resolvedAt).toBeTruthy();

                const detail = await getTransactionDetail(rows[0].id, caller);
                expect(detail.status).toBe("cancelled");
                expect(detail.items.length).toBe(1);
                expect(detail.items[0].product_variant_id).toBe(product.shopProductId);
            } finally {
                await db.delete(posCheckoutTransactions).where(eq(posCheckoutTransactions.refCode, refCode));
                await db.delete(paymentIntents).where(eq(paymentIntents.refCode, refCode));
                await deleteTestShopProduct(product.shopProductId);
            }
        },
        30_000,
    );
});

describe("getTransactionDetail — cart item resolution", () => {
    it.if(HAS_DB)(
        "resolves the product name for a successful checkout's cart items",
        async () => {
            if (!dbOk) return;
            const productTag = `POSTXN-DETAIL-OK-${tag()}`;
            const product = await createTestShopProduct(productTag);
            let receiptId: number | null = null;
            let txnId: number | null = null;
            try {
                const input: CheckoutInput = {
                    payment_method: "cash",
                    shop_id: product.shopId,
                    userId: cashierUserId,
                    cash_received: product.unitPrice,
                    items: [
                        {
                            product_variant_id: product.shopProductId,
                            quantity: 2,
                            unit_price: product.unitPrice,
                            discount: 0,
                        },
                    ],
                };
                const receipt = await checkout(input);
                receiptId = receipt.id;

                const rows = await db
                    .select({ id: posCheckoutTransactions.id })
                    .from(posCheckoutTransactions)
                    .where(eq(posCheckoutTransactions.receiptId, receiptId))
                    .orderBy(desc(posCheckoutTransactions.id))
                    .limit(1);
                txnId = rows[0]?.id ?? null;
                expect(txnId).not.toBeNull();

                const detail = await getTransactionDetail(txnId as number, caller);
                expect(detail.items.length).toBe(1);
                expect(detail.items[0].product_variant_id).toBe(product.shopProductId);
                expect(detail.items[0].quantity).toBe(2);
                expect(detail.items[0].is_bundle).toBe(false);
                expect(detail.items[0].name).toBe(`Concurrency Test Item ${productTag}`);
            } finally {
                if (txnId != null) await db.delete(posCheckoutTransactions).where(eq(posCheckoutTransactions.id, txnId));
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
        "falls back to 'Product #<id>' when the cart referenced an id that never resolved (the failed-checkout case)",
        async () => {
            if (!dbOk) return;
            const shopId = `POSTXN-DETAIL-FAIL-${tag()}`;
            const input: CheckoutInput = {
                payment_method: "cash",
                shop_id: shopId,
                userId: cashierUserId,
                items: [{ product_variant_id: -888_888, quantity: 3, unit_price: 50, discount: 0 }],
            };
            await expect(checkout(input)).rejects.toThrow(/not found/);

            const rows = await db
                .select({ id: posCheckoutTransactions.id })
                .from(posCheckoutTransactions)
                .where(eq(posCheckoutTransactions.shopId, shopId))
                .orderBy(desc(posCheckoutTransactions.id))
                .limit(1);
            const txnId = rows[0]?.id ?? null;
            expect(txnId).not.toBeNull();
            try {
                const detail = await getTransactionDetail(txnId as number, caller);
                expect(detail.items.length).toBe(1);
                expect(detail.items[0].product_variant_id).toBe(-888_888);
                expect(detail.items[0].quantity).toBe(3);
                expect(detail.items[0].name).toBe("Product #-888888");
            } finally {
                if (txnId != null) await db.delete(posCheckoutTransactions).where(eq(posCheckoutTransactions.id, txnId));
            }
        },
        30_000,
    );

    it.if(HAS_DB)(
        "resolves a bundle item's name, and shows it before any webhook resolves the row (still 'pending')",
        async () => {
            if (!dbOk) return;
            const product = await createTestShopProduct(`POSTXN-DETAIL-BUNDLE-${tag()}`);
            const bundleTag = `POSTXN-BUNDLE-${tag()}`;
            let bundleId: number | null = null;
            let txnId: number | null = null;
            try {
                const [bundle] = await db
                    .insert(productBundles)
                    .values({
                        shopId: product.shopId,
                        bundleCode: `TSTB-${bundleTag}`,
                        name: `Test Bundle ${bundleTag}`,
                        externalPrice: "150.00",
                        internalPrice: "120.00",
                        sortOrder: 0,
                        isActive: true,
                    })
                    .returning({ id: productBundles.id });
                bundleId = bundle.id;

                // Simulates what createPosQrIntent snapshots at intent-creation
                // time — items must be visible from that moment, well before any
                // webhook resolves the row.
                txnId = await startTransaction({
                    paymentMethod: "bay_qr",
                    shopId: product.shopId,
                    cashierUserId,
                    itemsCount: 1,
                    amount: 150,
                    items: [
                        {
                            product_variant_id: product.shopProductId,
                            quantity: 1,
                            unit_price: 150,
                            is_bundle: true,
                            bundle_id: bundleId,
                        },
                    ],
                });
                expect(txnId).not.toBeNull();

                const detail = await getTransactionDetail(txnId as number, caller);
                expect(detail.status).toBe("pending");
                expect(detail.items.length).toBe(1);
                expect(detail.items[0].is_bundle).toBe(true);
                expect(detail.items[0].bundle_id).toBe(bundleId);
                expect(detail.items[0].name).toBe(`Test Bundle ${bundleTag}`);
            } finally {
                if (txnId != null) await db.delete(posCheckoutTransactions).where(eq(posCheckoutTransactions.id, txnId));
                if (bundleId != null) await db.delete(productBundles).where(eq(productBundles.id, bundleId));
                await deleteTestShopProduct(product.shopProductId);
            }
        },
        30_000,
    );
});

describe("listTransactions — filtering", () => {
    it.if(HAS_DB)(
        "filters by shop_id and status",
        async () => {
            if (!dbOk) return;
            const shopId = `POSTXN-LIST-${tag()}`;
            const idPending = await startTransaction({
                paymentMethod: "cash",
                shopId,
                cashierUserId,
                itemsCount: 1,
                amount: 10,
            });
            const idFailed = await startTransaction({
                paymentMethod: "cash",
                shopId,
                cashierUserId,
                itemsCount: 1,
                amount: 20,
            });
            try {
                expect(idPending).not.toBeNull();
                expect(idFailed).not.toBeNull();

                const caller: AccessTokenPayload = {
                    sub: String(cashierUserId),
                    username: "test",
                    email: "test@example.com",
                    roles: ["admin"],
                    is_superuser: true,
                    shop_id: null,
                    shop_module: null,
                    family_code: null,
                    exp: 0,
                    type: "access",
                };

                const all = await listTransactions({ caller, shopId });
                expect(all.total).toBe(2);

                const onlyPending = await listTransactions({ caller, shopId, status: "pending" });
                expect(onlyPending.total).toBe(2); // both start pending
                expect(onlyPending.items.every((i) => i.status === "pending")).toBe(true);
            } finally {
                if (idPending != null) await db.delete(posCheckoutTransactions).where(eq(posCheckoutTransactions.id, idPending));
                if (idFailed != null) await db.delete(posCheckoutTransactions).where(eq(posCheckoutTransactions.id, idFailed));
            }
        },
        30_000,
    );
});
