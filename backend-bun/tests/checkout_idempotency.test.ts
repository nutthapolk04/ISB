/**
 * Checkout idempotency.
 *
 * Before this existed, a cashier who double-clicked Confirm — or whose client
 * retried after a lost response — got two receipts and had the stock deducted
 * twice, with nothing in the system linking the pair. There was no guard at
 * all.
 *
 * Two properties carry the whole feature and both are money-critical:
 *
 *   1. **Same key ⇒ same receipt, once.** Repeats return the original and do
 *      no further work: no second stock movement, no second wallet debit.
 *   2. **No key ⇒ unchanged behaviour.** The kiosk and the BAY QR webhook
 *      never send one, and thousands of historical receipts have none, so the
 *      uniqueness index is partial and the old path must stay byte-identical.
 *
 * Conventions mirror the other DB-backed suites: localhost-only, run-unique
 * fixtures, cleaned up in `finally`.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { shopProducts, shopMovements, receipts, receiptItems } from "@/db/schema";
import { checkout, type CheckoutInput } from "@/services/pos_checkout_service";

const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
const DB_TIMEOUT_MS = 45_000;
const SHOP_ID = "S0001";
const TAG = `idem-${Date.now().toString(36)}`;

beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn("[checkout_idempotency] Skipping DB cases: DATABASE_URL is not localhost.");
    }
    if (HAS_DB) dbOk = await pingDb();
});

async function seedProduct(code: string, stock = 100): Promise<number> {
    const [p] = await db
        .insert(shopProducts)
        .values({
            shopId: SHOP_ID, productCode: code, name: `${code} fixture`, category: "TEST",
            externalPrice: "50.00", internalPrice: "30.00", avgCost: "30.0000",
            stock, isActive: true, vatPercent: "0", minStock: 0,
        })
        .returning({ id: shopProducts.id });
    return p.id;
}

async function cleanup(productIds: number[], receiptIds: number[]): Promise<void> {
    if (receiptIds.length) {
        await db.delete(receiptItems).where(inArray(receiptItems.receiptId, receiptIds));
        await db.delete(receipts).where(inArray(receipts.id, receiptIds));
    }
    if (productIds.length) {
        await db.delete(shopMovements).where(inArray(shopMovements.productId, productIds));
        await db.delete(shopProducts).where(inArray(shopProducts.id, productIds));
    }
}

const cartFor = (productId: number, qty = 2): CheckoutInput => ({
    payment_method: "cash",
    transaction_mode: "SALE",
    shop_id: SHOP_ID,
    items: [{ product_variant_id: productId, quantity: qty, unit_price: 50 }],
    cash_received: 1000,
    userId: 1,
});

describe("checkout idempotency (DB)", () => {
    it.if(HAS_DB)(
        "returns the same receipt on a repeat and deducts stock only once",
        async () => {
            if (!dbOk) return;
            const pid = await seedProduct(`${TAG}-A`);
            const receiptIds: number[] = [];
            try {
                const key = `${TAG}-key-A`;
                const first = await checkout({ ...cartFor(pid), idempotency_key: key });
                const second = await checkout({ ...cartFor(pid), idempotency_key: key });
                receiptIds.push(first.id);

                expect(second.id).toBe(first.id);
                expect(second.receipt_number).toBe(first.receipt_number);

                // Exactly one receipt, and the stock moved once — the whole point.
                const rows = await db.select().from(receipts).where(eq(receipts.idempotencyKey, key));
                expect(rows).toHaveLength(1);

                const moves = await db.select().from(shopMovements).where(eq(shopMovements.productId, pid));
                expect(moves).toHaveLength(1);

                const [prod] = await db.select().from(shopProducts).where(eq(shopProducts.id, pid));
                expect(prod.stock).toBe(98); // 100 - 2, not 96
            } finally {
                await cleanup([pid], receiptIds);
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "survives two concurrent calls with the same key — one receipt, not a crash",
        async () => {
            if (!dbOk) return;
            // The case a "check then insert" implementation gets wrong: both
            // requests see no existing row and both insert. Only the database
            // constraint can settle it, and the loser has to recover rather
            // than surfacing a 500.
            const pid = await seedProduct(`${TAG}-B`);
            const receiptIds: number[] = [];
            try {
                const key = `${TAG}-key-B`;
                const [a, b] = await Promise.all([
                    checkout({ ...cartFor(pid), idempotency_key: key }),
                    checkout({ ...cartFor(pid), idempotency_key: key }),
                ]);
                receiptIds.push(a.id);

                expect(a.id).toBe(b.id);
                const rows = await db.select().from(receipts).where(eq(receipts.idempotencyKey, key));
                expect(rows).toHaveLength(1);

                const [prod] = await db.select().from(shopProducts).where(eq(shopProducts.id, pid));
                expect(prod.stock).toBe(98);
            } finally {
                await cleanup([pid], receiptIds);
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "treats different keys as different sales",
        async () => {
            if (!dbOk) return;
            const pid = await seedProduct(`${TAG}-C`);
            const receiptIds: number[] = [];
            try {
                const one = await checkout({ ...cartFor(pid), idempotency_key: `${TAG}-c1` });
                const two = await checkout({ ...cartFor(pid), idempotency_key: `${TAG}-c2` });
                receiptIds.push(one.id, two.id);

                expect(two.id).not.toBe(one.id);
                const [prod] = await db.select().from(shopProducts).where(eq(shopProducts.id, pid));
                expect(prod.stock).toBe(96); // both sales landed
            } finally {
                await cleanup([pid], receiptIds);
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "leaves the no-key path exactly as it was",
        async () => {
            if (!dbOk) return;
            // The kiosk, the BAY QR webhook and every historical receipt have no
            // key. Two keyless sales must stay two sales — the partial index
            // must not collapse them on NULL.
            const pid = await seedProduct(`${TAG}-D`);
            const receiptIds: number[] = [];
            try {
                const one = await checkout(cartFor(pid));
                const two = await checkout(cartFor(pid));
                receiptIds.push(one.id, two.id);

                expect(two.id).not.toBe(one.id);
                const [prod] = await db.select().from(shopProducts).where(eq(shopProducts.id, pid));
                expect(prod.stock).toBe(96);

                for (const id of receiptIds) {
                    const [r] = await db.select().from(receipts).where(eq(receipts.id, id));
                    expect(r.idempotencyKey).toBeNull();
                }
            } finally {
                await cleanup([pid], receiptIds);
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "ignores a blank key rather than treating '' as a real one",
        async () => {
            if (!dbOk) return;
            // A frontend bug that sends "" must not make every sale collide on
            // the empty string.
            const pid = await seedProduct(`${TAG}-E`);
            const receiptIds: number[] = [];
            try {
                const one = await checkout({ ...cartFor(pid), idempotency_key: "" });
                const two = await checkout({ ...cartFor(pid), idempotency_key: "   " });
                receiptIds.push(one.id, two.id);
                expect(two.id).not.toBe(one.id);
                for (const id of receiptIds) {
                    const [r] = await db.select().from(receipts).where(eq(receipts.id, id));
                    expect(r.idempotencyKey).toBeNull();
                }
            } finally {
                await cleanup([pid], receiptIds);
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "does not run a second wallet debit on a repeat",
        async () => {
            if (!dbOk) return;
            // Stock is the visible symptom; the money is the serious one. A
            // replay must not touch the wallet again.
            const pid = await seedProduct(`${TAG}-F`);
            const receiptIds: number[] = [];
            try {
                const key = `${TAG}-key-F`;
                const first = await checkout({ ...cartFor(pid), idempotency_key: key });
                receiptIds.push(first.id);

                const before = await db.execute(
                    sql`SELECT count(*)::int AS n FROM wallet_transactions WHERE reference_type = 'receipt' AND reference_id = ${first.id}`,
                );
                await checkout({ ...cartFor(pid), idempotency_key: key });
                const after = await db.execute(
                    sql`SELECT count(*)::int AS n FROM wallet_transactions WHERE reference_type = 'receipt' AND reference_id = ${first.id}`,
                );
                expect((after as unknown as Array<{ n: number }>)[0].n)
                    .toBe((before as unknown as Array<{ n: number }>)[0].n);
            } finally {
                await cleanup([pid], receiptIds);
            }
        },
        DB_TIMEOUT_MS,
    );
});
