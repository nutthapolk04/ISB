import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { shops } from "@/db/schema";
import { createShop, updateShop, getShop } from "@/services/shop_service";

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

describe("EDC Fee Calculation in Checkout", () => {
  it("should calculate correct fee amount", () => {
    // Test calculation: amount × (fee_rate / 100)
    const testCases = [
      { amount: 1000, rate: 2.5, expected: 25 },
      { amount: 1000, rate: 3.0, expected: 30 },
      { amount: 500, rate: 2.5, expected: 12.5 },
      { amount: 1000, rate: 0, expected: 0 },
      { amount: 100.50, rate: 2.5, expected: 2.51 },
    ];

    testCases.forEach(({ amount, rate, expected }) => {
      const calculated = Math.round(amount * (rate / 100) * 100) / 100;
      expect(calculated).toBe(expected);
    });
  });

  it("should handle decimal precision correctly", () => {
    // Ensure no floating point errors
    const amount = 999.99;
    const rate = 2.5;
    const expected = 25.0;

    const calculated = Math.round(amount * (rate / 100) * 100) / 100;
    expect(calculated).toBe(expected);
  });
});
