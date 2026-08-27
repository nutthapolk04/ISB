import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { shops, receipts, receiptItems, users } from "@/db/schema";
import { createShop, updateShop, getShop } from "@/services/shop_service";
import { checkout, type CheckoutInput } from "@/services/pos_checkout_service";
import { createTestShopProduct, deleteTestShopProduct } from "./wallet_test_fixtures";

describe("EDC Card Fee Rate", () => {
  const createdShops: string[] = [];

  afterAll(async () => {
    for (const shopId of createdShops) {
      try {
        await db.delete(shops).where(eq(shops.id, shopId));
      } catch {
        // Cleanup may fail if shop doesn't exist
      }
    }
  });

  it("should create shop with edc_card_fee_rate", async () => {
    const testShopId = `test-create-${Date.now()}`;
    const shop = await createShop({
      id: testShopId,
      name: "Test Shop EDC Fee",
      edc_card_fee_rate: 2.5,
    });
    createdShops.push(testShopId);

    expect(shop.id).toBe(testShopId);
    expect(shop.edc_card_fee_rate).toBe(2.5);
    expect(shop.name).toBe("Test Shop EDC Fee");
  });

  it("should default edc_card_fee_rate to 0 if not provided", async () => {
    const shopId = `test-default-${Date.now()}`;
    const shop = await createShop({
      id: shopId,
      name: "Test Shop No Fee",
    });
    createdShops.push(shopId);

    expect(shop.edc_card_fee_rate).toBe(0);
  });

  it("should update edc_card_fee_rate", async () => {
    const shopId = `test-update-${Date.now()}`;
    const shop = await createShop({
      id: shopId,
      name: "Test Shop Update Fee",
      edc_card_fee_rate: 1.5,
    });
    createdShops.push(shopId);

    const updated = await updateShop(shop.id, {
      edc_card_fee_rate: 3.0,
    });

    expect(updated.edc_card_fee_rate).toBe(3.0);
  });

  it("should retrieve shop with edc_card_fee_rate", async () => {
    const shopId = `test-retrieve-${Date.now()}`;
    await createShop({
      id: shopId,
      name: "Test Retrieve Fee",
      edc_card_fee_rate: 2.75,
    });
    createdShops.push(shopId);

    const shop = await getShop(shopId);
    expect(shop).not.toBeNull();
    expect(shop!.edc_card_fee_rate).toBe(2.75);
  });

  it("should allow zero fee rate (disabled)", async () => {
    const shop = await createShop({
      id: `test-zero-${Date.now()}`,
      name: "Test Zero Fee",
      edc_card_fee_rate: 0,
    });

    expect(shop.edc_card_fee_rate).toBe(0);

    await db.delete(shops).where(eq(shops.id, shop.id));
  });

  it("should allow setting fee to 100%", async () => {
    const shopId = `test-max-${Date.now()}`;
    const shop = await createShop({
      id: shopId,
      name: "Test Max Fee",
      edc_card_fee_rate: 100,
    });

    expect(shop.edc_card_fee_rate).toBe(100);

    await db.delete(shops).where(eq(shops.id, shopId));
  });
});

// Integration coverage: does checkout() itself read the shop's configured
// edc_card_fee_rate and apply it to the receipt total, not just a formula
// asserted against itself? This is what the earlier "EDC Fee Calculation in
// Checkout" block (removed here) never actually verified — it reimplemented
// the rounding formula and compared it to itself, so a real regression in
// pos_checkout_service.ts (e.g. the fee gate on edc_mode, or the rate never
// being read from the DB) would have passed silently.
describe("EDC Fee Applied at Checkout (integration)", () => {
  const HAS_DB = !!process.env.DATABASE_URL;
  let dbOk = false;
  let cashierUserId = 0;
  const testShopIds: string[] = [];

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

  afterAll(async () => {
    for (const shopId of testShopIds) {
      try {
        await db.delete(shops).where(eq(shops.id, shopId));
      } catch {
        // Cleanup may fail if shop doesn't exist
      }
    }
  });

  function tag(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // Kept short: generateReceiptNumber builds "R-<shopId>-<yyyymmdd>-<seq>"
  // into receipts.receipt_number, which is varchar(50) — a verbose shop id
  // (e.g. the "test-edc-checkout-<ts>-<rand>" this replaced) overflows it.
  function shortTag(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  async function newShopWithFeeRate(rate: number): Promise<string> {
    const shopId = `edcfee-${shortTag()}`;
    await createShop({ id: shopId, name: `Test EDC Checkout ${shopId}`, edc_card_fee_rate: rate });
    testShopIds.push(shopId);
    return shopId;
  }

  it.if(HAS_DB)(
    "a card-mode EDC sale charges the shop's configured fee rate on top of the goods total",
    async () => {
      if (!dbOk) return;
      const shopId = await newShopWithFeeRate(3);
      const product = await createTestShopProduct(`EDCFEE-CARD-${tag()}`, shopId);
      let receiptId: number | null = null;
      try {
        const input: CheckoutInput = {
          payment_method: "edc",
          shop_id: shopId,
          userId: cashierUserId,
          edc_approval_code: "TEST-APPR",
          edc_mode: "card",
          items: [
            { product_variant_id: product.shopProductId, quantity: 2, unit_price: 100, discount: 0 },
          ],
        };
        const receipt = await checkout(input);
        receiptId = receipt.id;

        expect(receipt.subtotal).toBe(200);
        expect(receipt.edc_card_fee).toBe(6); // 200 * 3%
        expect(receipt.total).toBe(206);
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
    "a QR-mode EDC sale is never charged the card fee, even when the shop has a rate configured",
    async () => {
      if (!dbOk) return;
      const shopId = await newShopWithFeeRate(3);
      const product = await createTestShopProduct(`EDCFEE-QR-${tag()}`, shopId);
      let receiptId: number | null = null;
      try {
        const input: CheckoutInput = {
          payment_method: "edc",
          shop_id: shopId,
          userId: cashierUserId,
          edc_approval_code: "TEST-APPR",
          edc_mode: "qr",
          items: [
            { product_variant_id: product.shopProductId, quantity: 1, unit_price: 100, discount: 0 },
          ],
        };
        const receipt = await checkout(input);
        receiptId = receipt.id;

        expect(receipt.edc_card_fee).toBe(0);
        expect(receipt.total).toBe(100);
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
    "the fee is rounded to 2 decimal places when the rate produces a fractional amount",
    async () => {
      if (!dbOk) return;
      const shopId = await newShopWithFeeRate(2.5);
      const product = await createTestShopProduct(`EDCFEE-DEC-${tag()}`, shopId);
      let receiptId: number | null = null;
      try {
        const input: CheckoutInput = {
          payment_method: "edc",
          shop_id: shopId,
          userId: cashierUserId,
          edc_approval_code: "TEST-APPR",
          edc_mode: "card",
          items: [
            { product_variant_id: product.shopProductId, quantity: 1, unit_price: 100.5, discount: 0 },
          ],
        };
        const receipt = await checkout(input);
        receiptId = receipt.id;

        // 100.50 * 2.5% = 2.5125 → rounds to 2.51
        expect(receipt.edc_card_fee).toBe(2.51);
        expect(receipt.total).toBe(103.01);
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
});
