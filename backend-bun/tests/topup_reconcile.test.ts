import { describe, expect, it, beforeAll, mock } from "bun:test";
import { eq } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { paymentIntents } from "@/db/schema";
import * as RealPymtGateway from "@/services/pymt_gateway";

const HAS_DB = !!process.env.DATABASE_URL;
let dbOk = false;

/**
 * Reconcile calls straight into pymt_gateway's qrInquiry/easyPayInquiry
 * (real HTTP to BAY). Mock the whole module so the sweep never hits the
 * live UAT gateway — the mutable `inquiryStatus`/`inquiryRawStatus` let each
 * test drive a different gateway answer. Bun's mock.module rewrites the
 * module's exported bindings in place, so this is effective even though
 * topup_service already imported the real module by the time this runs.
 */
let inquiryStatus: "pending" | "confirmed" | "cancelled" = "pending";
let inquiryRawStatus = "PENDING";

mock.module("@/services/pymt_gateway", () => ({
    ...RealPymtGateway,
    isPymtConfigured: () => true,
    qrInquiry: async (_args: { transactionNo: string }) => ({
        status: inquiryStatus,
        raw_status: inquiryRawStatus,
        txn_no: _args.transactionNo,
        card_no: null,
        payment_method: "PromptPay",
        paid_at: inquiryStatus === "confirmed" ? new Date().toISOString() : null,
        bay_trx_status: null,
    }),
    easyPayInquiry: async (_args: { transactionNo: string }) => ({
        status: inquiryStatus,
        raw_status: inquiryRawStatus,
        txn_no: _args.transactionNo,
        card_no: "411111******1111",
        payment_method: "Visa",
        paid_at: inquiryStatus === "confirmed" ? new Date().toISOString() : null,
        bay_trx_status: null,
    }),
}));

import { reconcilePendingTopups } from "@/services/topup_service";
import {
    createTestWalletFixture,
    deleteTestWalletFixture,
    getWalletBalance,
    countWalletTransactions,
} from "./wallet_test_fixtures";

beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    }
    if (HAS_DB) {
        dbOk = await pingDb();
    }
});

async function insertStaleIntent(args: {
    refCode: string;
    walletId: number;
    amount: number;
    createdBy: number | null;
    paymentMethod?: string;
    ageMinutes?: number;
    intentType?: string | null;
    txnNo?: string | null;
}): Promise<number> {
    const [row] = await db
        .insert(paymentIntents)
        .values({
            refCode: args.refCode,
            walletId: args.walletId,
            amount: String(args.amount),
            qrPayload: `test://${args.refCode}`,
            status: "pending",
            paymentMethod: args.paymentMethod ?? "bay_qr",
            createdBy: args.createdBy,
            txnNo: args.txnNo === undefined ? `TXN-${args.refCode}` : args.txnNo,
            intentType: args.intentType === undefined ? null : args.intentType,
        })
        .returning({ id: paymentIntents.id });

    const ageMinutes = args.ageMinutes ?? 30;
    const backdated = new Date(Date.now() - ageMinutes * 60_000).toISOString();
    await db.update(paymentIntents).set({ createdAt: backdated }).where(eq(paymentIntents.id, row.id));

    return row.id;
}

async function getIntentStatus(refCode: string): Promise<string | undefined> {
    const rows = await db.select({ status: paymentIntents.status }).from(paymentIntents).where(eq(paymentIntents.refCode, refCode)).limit(1);
    return rows[0]?.status;
}

describe("reconcilePendingTopups — damage-control sweep", () => {
    it.if(HAS_DB)(
        "dryRun=true: gateway COMPLETED is reported in `credited` but nothing is actually credited",
        async () => {
            if (!dbOk) return;
            const fixture = await createTestWalletFixture(0);
            const refCode = `TEST-RECON-DRY-${fixture.tag}`;
            try {
                await insertStaleIntent({ refCode, walletId: fixture.walletId, amount: 200, createdBy: null });
                inquiryStatus = "confirmed";
                inquiryRawStatus = "COMPLETED";

                const summary = await reconcilePendingTopups({ olderThanMinutes: 15, limit: 10, dryRun: true });

                expect(summary.dry_run).toBe(true);
                const item = summary.credited.find((i) => i.ref_code === refCode);
                expect(item).toBeTruthy();
                expect(item?.amount).toBe(200);

                // Nothing actually mutated.
                expect(await getWalletBalance(fixture.walletId)).toBeCloseTo(0, 2);
                expect(await countWalletTransactions(fixture.walletId)).toBe(0);
                expect(await getIntentStatus(refCode)).toBe("pending");
            } finally {
                await deleteTestWalletFixture(fixture);
            }
        },
        30_000,
    );

    it.if(HAS_DB)(
        "dryRun=false: gateway COMPLETED credits the wallet exactly once, re-run does not double-credit",
        async () => {
            if (!dbOk) return;
            const fixture = await createTestWalletFixture(0);
            const refCode = `TEST-RECON-REAL-${fixture.tag}`;
            try {
                // created_by=null — exercises the same fallback-to-system-user
                // path as the hotfix, but from the sweep instead of the webhook.
                await insertStaleIntent({ refCode, walletId: fixture.walletId, amount: 175, createdBy: null });
                inquiryStatus = "confirmed";
                inquiryRawStatus = "COMPLETED";

                const first = await reconcilePendingTopups({ olderThanMinutes: 15, limit: 10, dryRun: false });
                expect(first.credited.some((i) => i.ref_code === refCode)).toBe(true);

                expect(await getWalletBalance(fixture.walletId)).toBeCloseTo(175, 2);
                expect(await countWalletTransactions(fixture.walletId)).toBe(1);
                expect(await getIntentStatus(refCode)).toBe("confirmed");

                // Re-run: intent is now 'confirmed' so it no longer matches the
                // WHERE clause at all — not even scanned, definitely not re-credited.
                const second = await reconcilePendingTopups({ olderThanMinutes: 15, limit: 10, dryRun: false });
                expect(second.credited.some((i) => i.ref_code === refCode)).toBe(false);
                expect(await getWalletBalance(fixture.walletId)).toBeCloseTo(175, 2);
                expect(await countWalletTransactions(fixture.walletId)).toBe(1);
            } finally {
                await deleteTestWalletFixture(fixture);
            }
        },
        30_000,
    );

    it.if(HAS_DB)(
        "gateway still PENDING: intent left untouched, reported in `skipped`",
        async () => {
            if (!dbOk) return;
            const fixture = await createTestWalletFixture(0);
            const refCode = `TEST-RECON-PEND-${fixture.tag}`;
            try {
                await insertStaleIntent({ refCode, walletId: fixture.walletId, amount: 300, createdBy: fixture.adminUserId });
                inquiryStatus = "pending";
                inquiryRawStatus = "PENDING";

                const summary = await reconcilePendingTopups({ olderThanMinutes: 15, limit: 10, dryRun: false });

                expect(summary.credited.some((i) => i.ref_code === refCode)).toBe(false);
                expect(summary.failed.some((i) => i.ref_code === refCode)).toBe(false);
                expect(summary.skipped.some((i) => i.ref_code === refCode)).toBe(true);

                expect(await getWalletBalance(fixture.walletId)).toBeCloseTo(0, 2);
                expect(await countWalletTransactions(fixture.walletId)).toBe(0);
                expect(await getIntentStatus(refCode)).toBe("pending");
            } finally {
                await deleteTestWalletFixture(fixture);
            }
        },
        30_000,
    );

    it.if(HAS_DB)(
        "intent younger than olderThanMinutes is not scanned at all",
        async () => {
            if (!dbOk) return;
            const fixture = await createTestWalletFixture(0);
            const refCode = `TEST-RECON-FRESH-${fixture.tag}`;
            try {
                await insertStaleIntent({ refCode, walletId: fixture.walletId, amount: 50, createdBy: fixture.adminUserId, ageMinutes: 1 });
                inquiryStatus = "confirmed";
                inquiryRawStatus = "COMPLETED";

                const summary = await reconcilePendingTopups({ olderThanMinutes: 15, limit: 10, dryRun: true });

                expect(summary.credited.some((i) => i.ref_code === refCode)).toBe(false);
                expect(summary.failed.some((i) => i.ref_code === refCode)).toBe(false);
                expect(summary.skipped.some((i) => i.ref_code === refCode)).toBe(false);
            } finally {
                await deleteTestWalletFixture(fixture);
            }
        },
        30_000,
    );

    it.if(HAS_DB)(
        "intent_type='pos_sale' is never picked up by the top-up sweep",
        async () => {
            if (!dbOk) return;
            const fixture = await createTestWalletFixture(0);
            const refCode = `TEST-RECON-POS-${fixture.tag}`;
            try {
                await insertStaleIntent({
                    refCode,
                    walletId: fixture.walletId,
                    amount: 60,
                    createdBy: fixture.adminUserId,
                    intentType: "pos_sale",
                });
                inquiryStatus = "confirmed";
                inquiryRawStatus = "COMPLETED";

                const summary = await reconcilePendingTopups({ olderThanMinutes: 15, limit: 10, dryRun: true });

                expect(summary.credited.some((i) => i.ref_code === refCode)).toBe(false);
                expect(summary.failed.some((i) => i.ref_code === refCode)).toBe(false);
                expect(summary.skipped.some((i) => i.ref_code === refCode)).toBe(false);
            } finally {
                await deleteTestWalletFixture(fixture);
            }
        },
        30_000,
    );
});
