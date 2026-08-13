/**
 * Recording checkouts that never became receipts.
 *
 * The property that matters most is the one that sounds like a detail: a
 * timeout must never be written down as a failure without first proving the
 * sale did not land. Getting that backwards puts a phantom "failed ฿1,200" in
 * front of a manager for a sale that succeeded, and the obvious reaction —
 * ring it up again — is a double charge and a double stock deduction. The
 * idempotency key is what turns that from a guess into a lookup.
 *
 * Localhost-only and self-cleaning, like the other DB-backed suites.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { posFailedCheckouts, receipts, receiptItems, shopProducts, shopMovements } from "@/db/schema";
import {
    recordFailedCheckout,
    listFailedCheckouts,
    buildFailedCartSnapshot,
    pruneFailedCheckouts,
} from "@/services/failed_checkout_service";
import { checkout } from "@/services/pos_checkout_service";

const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
const DB_TIMEOUT_MS = 45_000;
const SHOP_ID = "S0001";
const TAG = `fail-${Date.now().toString(36)}`;

beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn("[failed_checkout] Skipping DB cases: DATABASE_URL is not localhost.");
    }
    if (HAS_DB) dbOk = await pingDb();
});

async function seedProduct(code: string): Promise<number> {
    const [p] = await db
        .insert(shopProducts)
        .values({
            shopId: SHOP_ID, productCode: code, name: `${code} widget`, category: "TEST",
            externalPrice: "50.00", internalPrice: "30.00", avgCost: "30.0000",
            stock: 100, isActive: true, vatPercent: "0", minStock: 0,
        })
        .returning({ id: shopProducts.id });
    return p.id;
}

// ── Snapshot building ─────────────────────────────────────────────────────

describe("buildFailedCartSnapshot (DB)", () => {
    it.if(HAS_DB)(
        "resolves product names at write time so the cart stays readable",
        async () => {
            if (!dbOk) return;
            // The checkout payload carries ids only. Resolving names later
            // would break the moment a product is renamed or deleted — which is
            // exactly the window this table has to survive.
            const pid = await seedProduct(`${TAG}-N`);
            try {
                const snap = await buildFailedCartSnapshot({
                    items: [{ product_variant_id: pid, quantity: 3, unit_price: 50, discount: 10 }],
                    discount: 5,
                });
                expect(snap.items).toHaveLength(1);
                expect(snap.items[0].name).toBe(`${TAG}-N widget`);
                expect(snap.items[0].product_code).toBe(`${TAG}-N`);
                expect(snap.items[0].line_total).toBe(140); // 3×50 − 10
                expect(snap.total).toBe(135);               // − 5 bill discount
            } finally {
                await db.delete(shopProducts).where(eq(shopProducts.id, pid));
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "still records a line whose product no longer exists",
        async () => {
            if (!dbOk) return;
            // A deleted product must not cost us the row — the quantity and the
            // price are the record; the name is a nicety.
            const snap = await buildFailedCartSnapshot({
                items: [{ product_variant_id: 999_999_999, quantity: 2, unit_price: 25 }],
            });
            expect(snap.items[0].name).toBe("(unknown product)");
            expect(snap.items[0].line_total).toBe(50);
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "prefers price_override over unit_price, as checkout does",
        async () => {
            if (!dbOk) return;
            const snap = await buildFailedCartSnapshot({
                items: [{ product_variant_id: 1, quantity: 2, unit_price: 50, price_override: 10 }],
            });
            expect(snap.items[0].unit_price).toBe(10);
            expect(snap.items[0].line_total).toBe(20);
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "survives a payload with no items at all",
        async () => {
            if (!dbOk) return;
            // This runs on the error path, where the payload may be exactly
            // what was malformed. It must not throw.
            const snap = await buildFailedCartSnapshot({});
            expect(snap.items).toEqual([]);
            expect(snap.total).toBe(0);
        },
        DB_TIMEOUT_MS,
    );
});

// ── Recording ─────────────────────────────────────────────────────────────

describe("recordFailedCheckout (DB)", () => {
    it.if(HAS_DB)(
        "stores a rejected checkout with its cart and error code",
        async () => {
            if (!dbOk) return;
            const pid = await seedProduct(`${TAG}-R`);
            const ids: number[] = [];
            try {
                const { id } = await recordFailedCheckout({
                    status: "rejected",
                    cashierUserId: null,
                    errorCode: "INSUFFICIENT_USER_WALLET",
                    errorMessage: "Insufficient wallet balance",
                    body: {
                        payment_method: "wallet",
                        transaction_mode: "sale",
                        shop_id: `${TAG}-shop`,
                        items: [{ product_variant_id: pid, quantity: 2, unit_price: 50 }],
                    },
                });
                expect(id).not.toBeNull();
                ids.push(id!);

                const [row] = await listFailedCheckouts({ shopId: `${TAG}-shop` });
                expect(row.status).toBe("rejected");
                expect(row.error_code).toBe("INSUFFICIENT_USER_WALLET");
                expect(row.payment_method).toBe("wallet");
                expect(row.amount).toBe(100);
                expect(row.cart_snapshot?.items[0].name).toBe(`${TAG}-R widget`);
            } finally {
                if (ids.length) await db.delete(posFailedCheckouts).where(inArray(posFailedCheckouts.id, ids));
                await db.delete(shopProducts).where(eq(shopProducts.id, pid));
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "DROPS a not_recorded report whose key already produced a receipt",
        async () => {
            if (!dbOk) return;
            // The load-bearing case. A timeout fires, the client reports it —
            // but the sale had actually landed. Writing a "failed" row here is
            // what would get the sale rung up twice.
            const pid = await seedProduct(`${TAG}-D`);
            const receiptIds: number[] = [];
            try {
                const key = `${TAG}-landed`;
                const r = await checkout({
                    payment_method: "cash", transaction_mode: "SALE", shop_id: SHOP_ID,
                    items: [{ product_variant_id: pid, quantity: 1, unit_price: 50 }],
                    cash_received: 100, userId: 1, idempotency_key: key,
                });
                receiptIds.push(r.id);

                const { id } = await recordFailedCheckout({
                    status: "not_recorded",
                    cashierUserId: null,
                    body: { shop_id: `${TAG}-drop`, idempotency_key: key, items: [] },
                });
                expect(id).toBeNull();
                expect(await listFailedCheckouts({ shopId: `${TAG}-drop` })).toHaveLength(0);
            } finally {
                if (receiptIds.length) {
                    await db.delete(receiptItems).where(inArray(receiptItems.receiptId, receiptIds));
                    await db.delete(receipts).where(inArray(receipts.id, receiptIds));
                }
                await db.delete(shopMovements).where(eq(shopMovements.productId, pid));
                await db.delete(shopProducts).where(eq(shopProducts.id, pid));
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "KEEPS a not_recorded report whose key produced no receipt",
        async () => {
            if (!dbOk) return;
            // The mirror image: nothing landed, so the cart genuinely is lost
            // and must be preserved.
            const ids: number[] = [];
            try {
                const { id } = await recordFailedCheckout({
                    status: "not_recorded",
                    cashierUserId: null,
                    errorMessage: "Request to /pos/checkout timed out after 30000ms",
                    body: { shop_id: `${TAG}-keep`, idempotency_key: `${TAG}-never-landed`, items: [] },
                });
                expect(id).not.toBeNull();
                ids.push(id!);

                const [row] = await listFailedCheckouts({ shopId: `${TAG}-keep` });
                expect(row.status).toBe("not_recorded");
                expect(row.error_message).toContain("timed out");
            } finally {
                if (ids.length) await db.delete(posFailedCheckouts).where(inArray(posFailedCheckouts.id, ids));
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "never throws, whatever it is handed",
        async () => {
            if (!dbOk) return;
            // This runs inside an error handler. If it can throw, it replaces
            // the message the cashier actually needs with its own.
            const ids: number[] = [];
            try {
                for (const body of [
                    {},
                    { items: "not-an-array" },
                    { items: [null, undefined, 42] },
                    { shop_id: "x".repeat(500), payment_method: "y".repeat(500) },
                ] as Array<Record<string, unknown>>) {
                    const res = await recordFailedCheckout({
                        status: "error", cashierUserId: null, body,
                    });
                    if (res.id !== null) ids.push(res.id);
                }
                expect(ids.length).toBeGreaterThan(0);
            } finally {
                if (ids.length) await db.delete(posFailedCheckouts).where(inArray(posFailedCheckouts.id, ids));
            }
        },
        DB_TIMEOUT_MS,
    );
});

// ── Retention ─────────────────────────────────────────────────────────────

describe("pruneFailedCheckouts (DB)", () => {
    it.if(HAS_DB)(
        "clears the cart at 90 days but keeps the row",
        async () => {
            if (!dbOk) return;
            const ids: number[] = [];
            try {
                const { id } = await recordFailedCheckout({
                    status: "rejected", cashierUserId: null,
                    body: { shop_id: `${TAG}-ret`, items: [{ product_variant_id: 1, quantity: 1, unit_price: 9 }] },
                });
                ids.push(id!);
                const aged = new Date(Date.now() - 91 * 86_400_000).toISOString();
                await db.update(posFailedCheckouts).set({ createdAt: aged })
                    .where(eq(posFailedCheckouts.id, id!));

                const res = await pruneFailedCheckouts();
                expect(res.snapshotsCleared).toBeGreaterThanOrEqual(1);

                const [row] = await db.select().from(posFailedCheckouts)
                    .where(eq(posFailedCheckouts.id, id!));
                expect(row).toBeDefined();       // row survives for disputes
                expect(row.cartSnapshot).toBeNull();
                expect(row.amount).toBe("9.00"); // the money stays
            } finally {
                if (ids.length) await db.delete(posFailedCheckouts).where(inArray(posFailedCheckouts.id, ids));
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "leaves a row inside the window untouched",
        async () => {
            if (!dbOk) return;
            const ids: number[] = [];
            try {
                const { id } = await recordFailedCheckout({
                    status: "rejected", cashierUserId: null,
                    body: { shop_id: `${TAG}-fresh`, items: [] },
                });
                ids.push(id!);
                // 60 days is inside 90 — the old 30-day window would have
                // cleared this, so it also pins the bump to 90.
                const aged = new Date(Date.now() - 60 * 86_400_000).toISOString();
                await db.update(posFailedCheckouts).set({ createdAt: aged })
                    .where(eq(posFailedCheckouts.id, id!));

                await pruneFailedCheckouts();
                const [row] = await db.select().from(posFailedCheckouts)
                    .where(eq(posFailedCheckouts.id, id!));
                expect(row.cartSnapshot).not.toBeNull();
            } finally {
                if (ids.length) await db.delete(posFailedCheckouts).where(inArray(posFailedCheckouts.id, ids));
            }
        },
        DB_TIMEOUT_MS,
    );
});
