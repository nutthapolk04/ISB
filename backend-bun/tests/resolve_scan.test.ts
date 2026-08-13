/**
 * Unified kiosk/POS scan resolve: users.card_uid → users.external_id →
 * customers.card_uid → customer code. Soft-falls through users without a wallet
 * (student login shell) so the customer wallet still resolves.
 */
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { customers, customerTypes, users, wallets } from "@/db/schema";
import { resolveScan } from "@/services/user_service";

const HAS_DB = !!process.env.DATABASE_URL;
let dbOk = false;

const TAG = `R${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`; // ≤8 chars
const cleanupUserIds: number[] = [];
const cleanupCustomerIds: number[] = [];
const cleanupWalletIds: number[] = [];

beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    }
    if (HAS_DB) {
        dbOk = await pingDb();
    }
});

afterAll(async () => {
    if (!dbOk) return;
    for (const id of cleanupWalletIds) {
        await db.delete(wallets).where(eq(wallets.id, id));
    }
    for (const id of cleanupCustomerIds) {
        await db.delete(customers).where(eq(customers.id, id));
    }
    for (const id of cleanupUserIds) {
        await db.delete(users).where(eq(users.id, id));
    }
});

async function seedParentWithCard(opts: {
    username: string;
    cardUid: string;
    externalId: string;
}): Promise<{ userId: number; walletId: number }> {
    const [u] = await db
        .insert(users)
        .values({
            username: opts.username,
            email: `${opts.username}@fixture.invalid`,
            fullName: `${opts.username} parent`,
            hashedPassword: "x",
            isActive: true,
            isSuperuser: false,
            role: "parent",
            cardUid: opts.cardUid,
            externalId: opts.externalId,
        })
        .returning({ id: users.id });
    cleanupUserIds.push(u.id);
    const [w] = await db
        .insert(wallets)
        .values({ userId: u.id, balance: "42.50", isActive: true })
        .returning({ id: wallets.id });
    cleanupWalletIds.push(w.id);
    return { userId: u.id, walletId: w.id };
}

async function seedStudentShellAndCustomer(opts: {
    extId: string;
    cardUid: string;
}): Promise<{ customerId: number; walletId: number; shellUserId: number }> {
    const ct = await db.select({ id: customerTypes.id }).from(customerTypes).limit(1);
    if (!ct[0]) throw new Error("No customer_types — seed DB");

    const [shell] = await db
        .insert(users)
        .values({
            username: opts.extId,
            email: `${opts.extId}@students.fixture.invalid`,
            fullName: `Student ${opts.extId}`,
            hashedPassword: "x",
            isActive: true,
            isSuperuser: false,
            role: "student",
            externalId: opts.extId,
            // no cardUid, no wallet — mirrors PowerSchool login shell
        })
        .returning({ id: users.id });
    cleanupUserIds.push(shell.id);

    const [c] = await db
        .insert(customers)
        .values({
            customerCode: `ISB-${opts.extId}`,
            studentCode: opts.extId,
            name: `Student ${opts.extId}`,
            customerTypeId: ct[0].id,
            isActive: true,
            cardFrozen: false,
            customerKind: "student",
            externalId: opts.extId,
            cardUid: opts.cardUid,
        })
        .returning({ id: customers.id });
    cleanupCustomerIds.push(c.id);

    const [w] = await db
        .insert(wallets)
        .values({ customerId: c.id, balance: "10", isActive: true })
        .returning({ id: wallets.id });
    cleanupWalletIds.push(w.id);

    return { customerId: c.id, walletId: w.id, shellUserId: shell.id };
}

describe("resolveScan", () => {
    it.if(HAS_DB)("matches parent by NFC card_uid (incl. reversed hex)", async () => {
        if (!dbOk) return;
        const cardForward = [...Array(4)]
            .map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase();
        const cardReversed = cardForward.match(/.{2}/g)!.reverse().join("");
        const { userId, walletId } = await seedParentWithCard({
            username: `${TAG}p1`,
            cardUid: cardReversed,
            externalId: `${TAG}e1`,
        });

        const byForward = await resolveScan(cardForward);
        expect(byForward.entity_type).toBe("user");
        expect(byForward.matched_by).toBe("user_card_uid");
        expect(byForward.user_id).toBe(userId);
        expect(byForward.wallet_id).toBe(walletId);

        const byStored = await resolveScan(cardReversed);
        expect(byStored.matched_by).toBe("user_card_uid");
        expect(byStored.wallet_id).toBe(walletId);
    });

    it.if(HAS_DB)("matches parent by external_id barcode", async () => {
        if (!dbOk) return;
        const ext = `${TAG}e2`;
        const { userId } = await seedParentWithCard({
            username: `${TAG}p2`,
            cardUid: `${TAG}c2`,
            externalId: ext,
        });

        const hit = await resolveScan(ext);
        expect(hit.entity_type).toBe("user");
        expect(hit.matched_by).toBe("user_external_id");
        expect(hit.user_id).toBe(userId);
    });

    it.if(HAS_DB)("falls through student login shell to customer wallet on barcode", async () => {
        if (!dbOk) return;
        const ext = `${TAG}s1`;
        const { customerId, walletId } = await seedStudentShellAndCustomer({
            extId: ext,
            cardUid: `${TAG}sc1`,
        });

        const hit = await resolveScan(ext);
        expect(hit.entity_type).toBe("customer");
        expect(hit.matched_by).toBe("customer_code");
        expect(hit.id).toBe(customerId);
        expect(hit.wallet_id).toBe(walletId);
        expect(hit.user_id).toBeNull();
    });

    it.if(HAS_DB)("matches student by NFC card_uid on customers", async () => {
        if (!dbOk) return;
        const card = `${TAG}sc2`;
        const { customerId, walletId } = await seedStudentShellAndCustomer({
            extId: `${TAG}s2`,
            cardUid: card,
        });

        const hit = await resolveScan(card);
        expect(hit.entity_type).toBe("customer");
        expect(hit.matched_by).toBe("customer_card_uid");
        expect(hit.id).toBe(customerId);
        expect(hit.wallet_id).toBe(walletId);
    });

    it.if(HAS_DB)("throws 404 when nothing matches", async () => {
        if (!dbOk) return;
        try {
            await resolveScan(`${TAG}gone`);
            expect(true).toBe(false);
        } catch (e) {
            expect((e as { status?: number }).status).toBe(404);
        }
    });
});
