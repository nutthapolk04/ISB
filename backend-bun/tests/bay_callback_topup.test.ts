import { describe, expect, it, beforeAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { paymentIntents, users, walletTransactions } from "@/db/schema";
import { handleBayCallback, confirmTopup } from "@/services/topup_service";
import {
    createTestWalletFixture,
    deleteTestWalletFixture,
    setWalletBalance,
    getWalletBalance,
    countWalletTransactions,
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

async function insertPendingIntent(args: {
    refCode: string;
    walletId: number;
    amount: number;
    createdBy: number | null;
    paymentMethod?: string;
}): Promise<number> {
    const [row] = await db
        .insert(paymentIntents)
        .values({
            refCode: args.refCode,
            walletId: args.walletId,
            amount: String(args.amount),
            qrPayload: `test://${args.refCode}`,
            status: "pending",
            paymentMethod: args.paymentMethod ?? "credit_card",
            createdBy: args.createdBy,
        })
        .returning({ id: paymentIntents.id });
    return row.id;
}

async function getIntentStatus(refCode: string): Promise<string | undefined> {
    const rows = await db.select({ status: paymentIntents.status }).from(paymentIntents).where(eq(paymentIntents.refCode, refCode)).limit(1);
    return rows[0]?.status;
}

describe("BAY callback — top-up wallet crediting (hotfix)", () => {
    it.if(HAS_DB)(
        "COMPLETED + created_by=null still credits the wallet (never silently skipped)",
        async () => {
            if (!dbOk) return;
            const fixture = await createTestWalletFixture(0);
            const refCode = `TEST-BAY-NULL-${fixture.tag}`;
            try {
                await insertPendingIntent({ refCode, walletId: fixture.walletId, amount: 150, createdBy: null });

                const result = await handleBayCallback({ orderRef: refCode, amount: 150, status: "COMPLETED" });
                expect(result).toEqual({ received: true });

                const balance = await getWalletBalance(fixture.walletId);
                expect(balance).toBeCloseTo(150, 2);

                const txCount = await countWalletTransactions(fixture.walletId);
                expect(txCount).toBe(1);

                expect(await getIntentStatus(refCode)).toBe("confirmed");

                // The credit must be attributed to the self-healing fallback
                // service account, not left with a null actor.
                const serviceUser = (await db.select({ id: users.id }).from(users).where(eq(users.username, "payment_gateway_service")).limit(1))[0];
                expect(serviceUser).toBeTruthy();

                const txRows = await db.select({ createdBy: walletTransactions.createdBy }).from(walletTransactions).where(eq(walletTransactions.walletId, fixture.walletId)).limit(1);
                expect(txRows[0]?.createdBy).toBe(serviceUser!.id);
            } finally {
                await deleteTestWalletFixture(fixture);
            }
        },
        30_000,
    );

    it.if(HAS_DB)(
        "duplicate COMPLETED callback credits the wallet exactly once",
        async () => {
            if (!dbOk) return;
            const fixture = await createTestWalletFixture(0);
            const refCode = `TEST-BAY-DUP-${fixture.tag}`;
            try {
                await insertPendingIntent({ refCode, walletId: fixture.walletId, amount: 100, createdBy: fixture.adminUserId });

                const first = await handleBayCallback({ orderRef: refCode, amount: 100, status: "COMPLETED" });
                const second = await handleBayCallback({ orderRef: refCode, amount: 100, status: "COMPLETED" });

                expect(first).toEqual({ received: true });
                expect(second).toEqual({ received: true });

                const balance = await getWalletBalance(fixture.walletId);
                expect(balance).toBeCloseTo(100, 2);
                expect(await countWalletTransactions(fixture.walletId)).toBe(1);
            } finally {
                await deleteTestWalletFixture(fixture);
            }
        },
        30_000,
    );

    it.if(HAS_DB)(
        "concurrent confirmTopup calls on the same intent credit exactly once (row-lock guard)",
        async () => {
            if (!dbOk) return;
            const fixture = await createTestWalletFixture(0);
            const refCode = `TEST-CONFIRM-DUP-${fixture.tag}`;
            try {
                await insertPendingIntent({ refCode, walletId: fixture.walletId, amount: 75, createdBy: fixture.adminUserId });

                const results = await Promise.allSettled([
                    confirmTopup({ refCode, confirmerId: fixture.adminUserId, confirmedVia: "gateway_webhook" }),
                    confirmTopup({ refCode, confirmerId: fixture.adminUserId, confirmedVia: "gateway_webhook" }),
                ]);

                const fulfilled = results.filter((r) => r.status === "fulfilled");
                const rejected = results.filter((r) => r.status === "rejected");
                expect(fulfilled.length).toBe(1);
                expect(rejected.length).toBe(1);
                const rejectedError = (rejected[0] as PromiseRejectedResult).reason as { code?: string };
                expect(rejectedError.code).toBe("ALREADY_PROCESSED");

                const balance = await getWalletBalance(fixture.walletId);
                expect(balance).toBeCloseTo(75, 2);
                expect(await countWalletTransactions(fixture.walletId)).toBe(1);
            } finally {
                await deleteTestWalletFixture(fixture);
            }
        },
        30_000,
    );

    it.if(HAS_DB)(
        "confirmTopup failure is not swallowed — handleBayCallback signals a retryable (thrown) error",
        async () => {
            if (!dbOk) return;
            const fixture = await createTestWalletFixture(0);
            const refCode = `TEST-BAY-FAIL-${fixture.tag}`;
            try {
                // Push the wallet balance to the edge of numeric(10,2) so
                // crediting overflows inside confirmTopup's transaction —
                // a genuine, deterministic failure unrelated to the
                // ALREADY_PROCESSED idempotency guard.
                await setWalletBalance(fixture.walletId, 99_999_900);
                await insertPendingIntent({ refCode, walletId: fixture.walletId, amount: 200, createdBy: fixture.adminUserId });

                await expect(
                    handleBayCallback({ orderRef: refCode, amount: 200, status: "COMPLETED" }),
                ).rejects.toBeTruthy();

                // Transaction rolled back — no partial credit, intent still pending.
                const balance = await getWalletBalance(fixture.walletId);
                expect(balance).toBeCloseTo(99_999_900, 2);
                expect(await getIntentStatus(refCode)).toBe("pending");
                expect(await countWalletTransactions(fixture.walletId)).toBe(0);
            } finally {
                await deleteTestWalletFixture(fixture);
            }
        },
        30_000,
    );
});
