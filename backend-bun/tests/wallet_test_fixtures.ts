import { eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  customers,
  customerTypes,
  paymentIntents,
  receiptItems,
  receipts,
  shopProducts,
  shops,
  users,
  walletTransactions,
  wallets,
} from "@/db/schema";

export interface TestWalletFixture {
  customerId: number;
  walletId: number;
  adminUserId: number;
  tag: string;
}

export async function createTestWalletFixture(initialBalance = 0): Promise<TestWalletFixture> {
  const tag = `TST-CONC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const ct = await db.select({ id: customerTypes.id }).from(customerTypes).limit(1);
  if (!ct[0]) {
    throw new Error("No customer_types row — seed DB before running wallet concurrency tests");
  }

  const admin = await db.select({ id: users.id }).from(users).limit(1);
  if (!admin[0]) {
    throw new Error("No users row — seed DB before running wallet concurrency tests");
  }

  const [customer] = await db
    .insert(customers)
    .values({
      customerCode: tag,
      name: `Concurrency Test ${tag}`,
      customerTypeId: ct[0].id,
      isActive: true,
      cardFrozen: false,
      customerKind: "student",
    })
    .returning({ id: customers.id });

  const [wallet] = await db
    .insert(wallets)
    .values({
      customerId: customer.id,
      balance: String(initialBalance),
      isActive: true,
    })
    .returning({ id: wallets.id });

  return {
    customerId: customer.id,
    walletId: wallet.id,
    adminUserId: admin[0].id,
    tag,
  };
}

export async function setWalletBalance(walletId: number, balance: number): Promise<void> {
  await db
    .update(wallets)
    .set({ balance: String(balance) })
    .where(eq(wallets.id, walletId));
}

export async function getWalletBalance(walletId: number): Promise<number> {
  const rows = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.id, walletId))
    .limit(1);
  return Number(rows[0]?.balance ?? 0);
}

export async function countWalletTransactions(walletId: number): Promise<number> {
  const rows = await db
    .select({ id: walletTransactions.id })
    .from(walletTransactions)
    .where(eq(walletTransactions.walletId, walletId));
  return rows.length;
}

export async function deleteTestWalletFixture(fixture: TestWalletFixture): Promise<void> {
  await db.delete(walletTransactions).where(eq(walletTransactions.walletId, fixture.walletId));
  await db.delete(paymentIntents).where(eq(paymentIntents.walletId, fixture.walletId));

  const receiptRows = await db
    .select({ id: receipts.id })
    .from(receipts)
    .where(eq(receipts.customerId, fixture.customerId));
  if (receiptRows.length > 0) {
    const receiptIds = receiptRows.map((r) => r.id);
    await db.delete(receiptItems).where(inArray(receiptItems.receiptId, receiptIds));
    await db.delete(receipts).where(inArray(receipts.id, receiptIds));
  }

  await db.delete(wallets).where(eq(wallets.id, fixture.walletId));
  await db.delete(customers).where(eq(customers.id, fixture.customerId));
}

export async function findProductForCheckout(): Promise<{
  shopProductId: number;
  shopId: string;
  unitPrice: number;
  createdForTest: boolean;
} | null> {
  const rows = await db
    .select({
      id: shopProducts.id,
      shopId: shopProducts.shopId,
      price: shopProducts.externalPrice,
      stock: shopProducts.stock,
    })
    .from(shopProducts)
    .where(gte(shopProducts.stock, 10))
    .limit(20);

  const pick = rows[0];
  if (pick) {
    return {
      shopProductId: pick.id,
      shopId: pick.shopId,
      unitPrice: Number(pick.price ?? 100),
      createdForTest: false,
    };
  }
  return null;
}

/** @deprecated Use findProductForCheckout — kept for import stability */
export const findCanteenProductForCheckout = findProductForCheckout;

async function findAnyShopId(): Promise<string> {
  const rows = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.isActive, true))
    .limit(1);
  if (!rows[0]) {
    throw new Error("No active shops row — seed DB before running wallet concurrency tests");
  }
  return rows[0].id;
}

export async function createTestShopProduct(
  tag: string,
  shopId?: string,
): Promise<{
  shopProductId: number;
  shopId: string;
  unitPrice: number;
}> {
  const effectiveShopId = shopId ?? (await findAnyShopId());
  const [p] = await db
    .insert(shopProducts)
    .values({
      shopId: effectiveShopId,
      productCode: `TST-${tag}`,
      name: `Concurrency Test Item ${tag}`,
      category: "Test",
      externalPrice: "100.00",
      internalPrice: "80.00",
      vatPercent: "7.00",
      avgCost: "50.0000",
      stock: 100,
      minStock: 0,
      isActive: true,
    })
    .returning({ id: shopProducts.id });

  return { shopProductId: p.id, shopId: effectiveShopId, unitPrice: 100 };
}

/** @deprecated Use createTestShopProduct */
export const createTestCanteenProduct = (tag: string) => createTestShopProduct(tag);

export async function deleteTestShopProduct(shopProductId: number): Promise<void> {
  await db.delete(shopProducts).where(eq(shopProducts.id, shopProductId));
}
