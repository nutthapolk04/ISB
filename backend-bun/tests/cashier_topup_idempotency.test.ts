import { describe, expect, it, beforeAll } from "bun:test";
import { pingDb } from "@/db/client";
import { cashierTopup } from "@/services/wallet_service";
import {
    createTestWalletFixture,
    deleteTestWalletFixture,
    countWalletTransactions,
    getWalletBalance,
} from "./wallet_test_fixtures";

const HAS_DB = !!process.env.DATABASE_URL;
let dbOk = false;

beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    }
    if (HAS_DB) {
        dbOk = await pingDb();
    }
});

describe("cashier top-up idempotency", () => {
    it.if(HAS_DB)(
        "duplicate idempotency_key credits wallet only once",
        async () => {
            if (!dbOk) return;
            const fixture = await createTestWalletFixture(0);
            const key = `test-idem-${fixture.tag}`;
            try {
                const first = await cashierTopup({
                    walletId: fixture.walletId,
                    amount: 250,
                    cashierUserId: fixture.adminUserId,
                    notes: "idempotency test",
                    idempotencyKey: key,
                });
                const second = await cashierTopup({
                    walletId: fixture.walletId,
                    amount: 250,
                    cashierUserId: fixture.adminUserId,
                    notes: "idempotency test retry",
                    idempotencyKey: key,
                });

                expect(second.transaction_id).toBe(first.transaction_id);
                expect(second.balance_after).toBeCloseTo(first.balance_after, 2);

                const balance = await getWalletBalance(fixture.walletId);
                expect(balance).toBeCloseTo(250, 2);

                const txCount = await countWalletTransactions(fixture.walletId);
                expect(txCount).toBe(1);
            } finally {
                await deleteTestWalletFixture(fixture);
            }
        },
        30_000,
    );

    it.if(HAS_DB)(
        "same idempotency_key with different amount returns 409",
        async () => {
            if (!dbOk) return;
            const fixture = await createTestWalletFixture(0);
            const key = `test-idem-conflict-${fixture.tag}`;
            try {
                await cashierTopup({
                    walletId: fixture.walletId,
                    amount: 100,
                    cashierUserId: fixture.adminUserId,
                    idempotencyKey: key,
                });

                let status: number | undefined;
                try {
                    await cashierTopup({
                        walletId: fixture.walletId,
                        amount: 200,
                        cashierUserId: fixture.adminUserId,
                        idempotencyKey: key,
                    });
                } catch (e) {
                    status = (e as { status?: number }).status;
                }
                expect(status).toBe(409);

                const balance = await getWalletBalance(fixture.walletId);
                expect(balance).toBeCloseTo(100, 2);
                expect(await countWalletTransactions(fixture.walletId)).toBe(1);
            } finally {
                await deleteTestWalletFixture(fixture);
            }
        },
        30_000,
    );
});
