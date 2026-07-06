import { describe, expect, it, beforeAll } from "bun:test";
import { pingDb } from "@/db/client";
import { cashierTopup } from "@/services/wallet_service";
import { checkout } from "@/services/pos_checkout_service";
import { confirmTopup, createTopupIntent } from "@/services/topup_service";
import {
  createTestWalletFixture,
  createTestShopProduct,
  deleteTestShopProduct,
  deleteTestWalletFixture,
  findProductForCheckout,
  getWalletBalance,
  countWalletTransactions,
  setWalletBalance,
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

const DB_TIMEOUT_MS = 45_000;

describe("wallet concurrency", () => {
  it.if(HAS_DB)(
    "parallel cashier top-ups accumulate balance correctly",
    async () => {
      if (!dbOk) return;
      const fixture = await createTestWalletFixture(0);
      try {
        const amounts = [100, 150, 200, 50];
        await Promise.all(
          amounts.map((amount) =>
            cashierTopup({
              walletId: fixture.walletId,
              amount,
              cashierUserId: fixture.adminUserId,
              notes: `concurrent-test ${fixture.tag}`,
            }),
          ),
        );

        const expectedTotal = amounts.reduce((a, b) => a + b, 0);
        const balance = await getWalletBalance(fixture.walletId);
        expect(balance).toBeCloseTo(expectedTotal, 2);

        const txCount = await countWalletTransactions(fixture.walletId);
        expect(txCount).toBe(4);
      } finally {
        await deleteTestWalletFixture(fixture);
      }
    },
    DB_TIMEOUT_MS,
  );

  it.if(HAS_DB)(
    "parallel wallet checkouts: only one succeeds when balance covers one sale",
    async () => {
      if (!dbOk) return;
      const fixture = await createTestWalletFixture(0);
      let testProductId: number | null = null;
      try {
        let product = await findProductForCheckout();
        if (!product) {
          const created = await createTestShopProduct(fixture.tag);
          testProductId = created.shopProductId;
          product = { ...created, createdForTest: true };
        }

        const saleAmount = Math.max(100, Math.ceil(product.unitPrice));
        await setWalletBalance(fixture.walletId, saleAmount);

        const makeCheckout = () =>
          checkout({
            payment_method: "WALLET",
            payer_kind: "customer",
            customer_id: fixture.customerId,
            items: [
              {
                product_variant_id: product.shopProductId,
                quantity: 1,
                unit_price: saleAmount,
              },
            ],
            shop_id: product.shopId,
            userId: fixture.adminUserId,
          });

        const outcomes = await Promise.allSettled([makeCheckout(), makeCheckout()]);

        const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
        const rejected = outcomes.filter((o) => o.status === "rejected");
        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);

        const balance = await getWalletBalance(fixture.walletId);
        expect(balance).toBeCloseTo(0, 2);

        const txCount = await countWalletTransactions(fixture.walletId);
        expect(txCount).toBe(1);
      } finally {
        if (testProductId != null) {
          await deleteTestShopProduct(testProductId);
        }
        await deleteTestWalletFixture(fixture);
      }
    },
    DB_TIMEOUT_MS,
  );

  it.if(HAS_DB)(
    "duplicate confirmTopup credits wallet only once",
    async () => {
      if (!dbOk) return;
      const fixture = await createTestWalletFixture(0);
      try {
        const intent = await createTopupIntent({
          walletId: fixture.walletId,
          amount: 100,
          userId: fixture.adminUserId,
          paymentMethod: "qr_promptpay",
        });

        const outcomes = await Promise.allSettled([
          confirmTopup({
            refCode: intent.ref_code,
            confirmerId: fixture.adminUserId,
            confirmedVia: "test",
          }),
          confirmTopup({
            refCode: intent.ref_code,
            confirmerId: fixture.adminUserId,
            confirmedVia: "test",
          }),
        ]);

        const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
        const rejected = outcomes.filter((o) => o.status === "rejected");
        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);

        const balance = await getWalletBalance(fixture.walletId);
        expect(balance).toBeCloseTo(100, 2);

        const txCount = await countWalletTransactions(fixture.walletId);
        expect(txCount).toBe(1);
      } finally {
        await deleteTestWalletFixture(fixture);
      }
    },
    DB_TIMEOUT_MS,
  );
});
