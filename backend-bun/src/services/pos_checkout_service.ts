import type { SqlTx } from "@/lib/sql_tx";
import { and, eq, sql, desc, like, inArray } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import {
  receipts,
  receiptItems,
  shopProducts,
  shopMovements,
  shops,
  customers,
  wallets,
  walletTransactions,
  productBundles,
  bundleItems,
  menuOptionGroups,
  menuOptions,
} from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";
import { getReceipt } from "@/services/pos_service";
import { getRaw as getSettingRaw } from "@/services/settings_service";
import { fifoDeductInTx } from "@/services/inventory_fifo";
import { checkAndSendLowBalanceAlerts } from "@/services/low_balance_notification";

const ALLOWED_PAYMENT_METHODS = new Set([
  "CASH",
  "CREDIT_CARD",
  "DEBIT_CARD",
  "WALLET",
  "BANK_TRANSFER",
  "CARD_TAP",
  "EDC",
  "DEPARTMENT",
  "OTHER",
  // QR PromptPay via BAY (POS sale). Stored as a distinct enum value so
  // reports can split QR receipts out from the legacy "OTHER" bucket that
  // covered the old fake-QR flow.
  "QR_PROMPTPAY",
]);

export interface SelectedOptionInput {
  option_id: number;
  quantity?: number;
}

export interface CheckoutItemInput {
  product_variant_id: number;
  quantity: number;
  unit_price: number;
  price_override?: number | null;
  discount?: number;
  options?: SelectedOptionInput[];
  is_bundle?: boolean;
  bundle_id?: number | null;
}

export interface CheckoutInput {
  transaction_mode?: "SALE" | "INTERNAL_ISSUE";
  payment_method: string;
  payer_kind?: "customer" | "user" | "department";
  customer_id?: number | null;
  payer_user_id?: number | null;
  payer_department_id?: number | null;
  requester_user_id?: number | null;
  items: CheckoutItemInput[];
  edc_terminal_ref?: string | null;
  edc_approval_code?: string | null;
  edc_masked_card?: string | null;
  cash_received?: number | null;
  discount?: number;
  notes?: string | null;
  shop_id?: string | null;
  userId: number;
}

async function generateReceiptNumber(sqlTx: SqlTx, shopId?: string | null): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const sid = shopId ?? "unknown";
  const prefix = `R-${sid}-${today}-`;
  const rows = await sqlTx<Array<{ receipt_number: string }>>`
    SELECT receipt_number FROM receipts
    WHERE receipt_number LIKE ${prefix + "%"}
    ORDER BY id DESC LIMIT 1
  `;
  let seq = 1;
  if (rows[0]) {
    const tail = rows[0].receipt_number.split("-").pop();
    const n = Number(tail);
    if (Number.isInteger(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

interface ResolvedOptions {
  snapshot: {
    groups: Array<{
      group_id: number;
      name: string;
      selection_type: string;
      options: Array<{ option_id: number; name: string; price_delta: number; quantity: number }>;
    }>;
    options_total: number;
  } | null;
  optionsTotal: number;
}

async function resolveOptions(
  productId: number,
  selected: SelectedOptionInput[],
): Promise<ResolvedOptions> {
  if (!selected || selected.length === 0) return { snapshot: null, optionsTotal: 0 };

  const groups = await db
    .select()
    .from(menuOptionGroups)
    .where(eq(menuOptionGroups.productId, productId));
  if (groups.length === 0) {
    const err = new Error(`Product ${productId} has no menu option groups`);
    (err as { status?: number }).status = 400;
    throw err;
  }
  const groupIds = groups.map((g) => g.id);
  const allOpts = await db
    .select()
    .from(menuOptions)
    .where(inArray(menuOptions.optionGroupId, groupIds));
  const optById = new Map(allOpts.map((o) => [o.id, o]));
  const groupById = new Map(groups.map((g) => [g.id, g]));

  const perGroup = new Map<number, Array<{ opt: typeof menuOptions.$inferSelect; qty: number }>>();
  let total = 0;
  for (const sel of selected) {
    const qty = sel.quantity ?? 1;
    if (qty < 1) {
      const err = new Error(`Option quantity must be >= 1 (got ${qty})`);
      (err as { status?: number }).status = 400;
      throw err;
    }
    const opt = optById.get(sel.option_id);
    if (!opt) {
      const err = new Error(`Unknown menu option id ${sel.option_id} for product ${productId}`);
      (err as { status?: number }).status = 400;
      throw err;
    }
    const arr = perGroup.get(opt.optionGroupId) ?? [];
    arr.push({ opt, qty });
    perGroup.set(opt.optionGroupId, arr);
    total += (pgNumber(opt.priceDelta) ?? 0) * qty;
  }

  for (const g of groups) {
    const picks = perGroup.get(g.id) ?? [];
    const pickCount = g.selectionType === "quantity"
      ? picks.reduce((s, p) => s + p.qty, 0)
      : picks.length;
    if (g.isRequired && pickCount < 1) {
      const err = new Error(`Option group '${g.name}' is required`);
      (err as { status?: number }).status = 400;
      throw err;
    }
    if (g.maxSelections !== null && pickCount > g.maxSelections) {
      const err = new Error(`Option group '${g.name}' allows at most ${g.maxSelections} selections`);
      (err as { status?: number }).status = 400;
      throw err;
    }
    if (g.selectionType === "single" && picks.length > 1) {
      const err = new Error(`Option group '${g.name}' allows only one selection`);
      (err as { status?: number }).status = 400;
      throw err;
    }
  }

  const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const groupsOut = sortedGroups
    .map((g) => {
      const picks = perGroup.get(g.id);
      if (!picks || picks.length === 0) return null;
      return {
        group_id: g.id,
        name: g.name,
        selection_type: g.selectionType,
        options: picks.map(({ opt, qty }) => ({
          option_id: opt.id,
          name: opt.name,
          price_delta: pgNumber(opt.priceDelta) ?? 0,
          quantity: qty,
        })),
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  const rounded = Math.round(total * 100) / 100;
  return {
    snapshot: { groups: groupsOut, options_total: rounded },
    optionsTotal: rounded,
  };
}

async function todayDeductedForWallet(walletId: number): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      total: sql<string>`COALESCE(SUM(CASE WHEN ${walletTransactions.transactionType} = 'DEDUCTION' THEN ${walletTransactions.amount} ELSE 0 END), 0)`,
    })
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.walletId, walletId),
        sql`${walletTransactions.createdAt} >= ${today + "T00:00:00+07:00"}`,
        sql`${walletTransactions.createdAt} <= ${today + "T23:59:59.999999+07:00"}`,
      ),
    );
  return pgNumber(rows[0]?.total ?? "0") ?? 0;
}

export const DEFAULT_DAILY_LIMIT_CANTEEN = 500;
export const DEFAULT_DAILY_LIMIT_STORE = 25_000;

export async function todayDeductedByModule(walletId: number, shopModule: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.execute(sql`
    SELECT COALESCE(SUM(wt.amount), 0) AS total
    FROM wallet_transactions wt
    JOIN receipts r ON r.id = CAST(wt.reference_id AS integer) AND wt.reference_type = 'receipt'
    JOIN shops s ON s.id = r.shop_id
    WHERE wt.wallet_id = ${walletId}
      AND wt.transaction_type = 'DEDUCTION'
      AND wt.created_at >= ${today + "T00:00:00+07:00"}
      AND wt.created_at <= ${today + "T23:59:59.999999+07:00"}
      AND s.module = ${shopModule}
  `);
  const row = (rows as unknown as Array<{ total: string | number }>)[0];
  return pgNumber(String(row?.total ?? "0")) ?? 0;
}

export async function checkout(input: CheckoutInput) {
  // ── Pre-flight validation ────────────────────────────────────────────
  const paymentMethod = (input.payment_method ?? "").toUpperCase();
  if (!ALLOWED_PAYMENT_METHODS.has(paymentMethod)) {
    const err = new Error(`Invalid payment_method '${input.payment_method}'`);
    (err as { status?: number }).status = 400;
    throw err;
  }
  const transactionMode = (input.transaction_mode ?? "SALE").toUpperCase();
  if (transactionMode !== "SALE" && transactionMode !== "INTERNAL_ISSUE") {
    const err = new Error(`Invalid transaction_mode '${input.transaction_mode}'`);
    (err as { status?: number }).status = 400;
    throw err;
  }
  if (!input.items || input.items.length === 0) {
    const err = new Error("items must not be empty");
    (err as { status?: number }).status = 400;
    throw err;
  }
  if (paymentMethod === "EDC" && !input.edc_approval_code?.trim()) {
    const err = new Error("EDC payment requires approval_code");
    (err as { status?: number }).status = 400;
    throw err;
  }

  const payerKind = input.payer_kind ?? "customer";
  const isDepartmentPayment = paymentMethod === "DEPARTMENT";
  const isWalletPayment = paymentMethod === "WALLET" || paymentMethod === "CARD_TAP";

  // ── Resolve shop_id (used by dept check, FIFO guard, audit) ─────────
  let effectiveShopId = input.shop_id ?? null;
  if (!effectiveShopId && input.items[0]) {
    const first = input.items[0];
    if (first.is_bundle && first.bundle_id) {
      const br = await db
        .select({ shopId: productBundles.shopId })
        .from(productBundles)
        .where(eq(productBundles.id, first.bundle_id))
        .limit(1);
      if (br[0]) effectiveShopId = br[0].shopId;
    } else {
      const pr = await db
        .select({ shopId: shopProducts.shopId })
        .from(shopProducts)
        .where(eq(shopProducts.id, first.product_variant_id))
        .limit(1);
      if (pr[0]) effectiveShopId = pr[0].shopId;
    }
  }

  // ── Shop type detection: drives FIFO branching in the deduction path.
  let effectiveShopType: "fifo" | "avg_cost" | null = null;
  let effectiveShopModule: string | null = null;
  if (effectiveShopId) {
    const sr = await db
      .select({ shopType: shops.shopType, allowDept: shops.allowDepartmentCharge, module: shops.module })
      .from(shops)
      .where(eq(shops.id, effectiveShopId))
      .limit(1);
    if (!sr[0]) {
      const err = new Error(`Shop '${effectiveShopId}' not found`);
      (err as { status?: number }).status = 400;
      throw err;
    }
    effectiveShopType = sr[0].shopType as "fifo" | "avg_cost";
    effectiveShopModule = sr[0].module ?? null;
    if (isDepartmentPayment && !sr[0].allowDept) {
      const err = new Error(
        `Shop '${effectiveShopId}' does not accept department charges (only coop shops can issue goods on department budget)`,
      );
      (err as { status?: number }).status = 400;
      throw err;
    }
  } else if (isDepartmentPayment) {
    const err = new Error("Department charge requires a shop context");
    (err as { status?: number }).status = 400;
    throw err;
  }

  // ── Snapshot spending_group_id ──────────────────────────────────────
  let receiptSpendingGroupId: number | null = null;
  if (effectiveShopId) {
    const sgr = await db
      .select({ sg: shops.spendingGroupId })
      .from(shops)
      .where(eq(shops.id, effectiveShopId))
      .limit(1);
    receiptSpendingGroupId = sgr[0]?.sg ?? null;
  }

  // ── Negative-balance policy flags ───────────────────────────────────
  const allowNegUser = ((await getSettingRaw("allow_negative_user_wallet")) as boolean) === true;
  const allowNegCustomer = ((await getSettingRaw("allow_negative_customer_wallet")) as boolean) === true;

  // Run the actual mutation under one DB transaction.
  let postCheckoutCustomerData: { customerId: number; balanceAfter: number } | null = null;
  const newReceiptId = await pgClient.begin(async (sqlTx) => {
    const receiptNumber = await generateReceiptNumber(sqlTx, effectiveShopId);

    let subtotal = 0;
    const movementType = transactionMode === "INTERNAL_ISSUE" ? "internal_use" : "sale";
    const today = new Date().toISOString().slice(0, 10);

    // Cache shopType lookups for products whose shop_id differs from
    // effectiveShopId (rare, but bundles + cross-shop checkout could trigger).
    const shopTypeCache = new Map<string, "fifo" | "avg_cost">();
    if (effectiveShopId && effectiveShopType) shopTypeCache.set(effectiveShopId, effectiveShopType);
    const lookupShopType = async (shopId: string): Promise<"fifo" | "avg_cost"> => {
      const cached = shopTypeCache.get(shopId);
      if (cached) return cached;
      const rows = await sqlTx<Array<{ shop_type: "fifo" | "avg_cost" }>>`
        SELECT shop_type FROM shops WHERE id = ${shopId}
      `;
      const t = (rows[0]?.shop_type ?? "avg_cost") as "fifo" | "avg_cost";
      shopTypeCache.set(shopId, t);
      return t;
    };

    // We collect items + audit summary as we go; rows inserted at end.
    interface PreparedItem {
      product_variant_id: number;
      quantity: number;
      unit_price: number;
      price_override: number | null;
      discount: number;
      line_total: number;
      options: unknown | null;
    }
    const prepared: PreparedItem[] = [];
    const auditLines: Array<{ name: string; qty: number; price: number }> = [];

    for (const item of input.items) {
      const qty = item.quantity;
      if (qty === 0) {
        const err = new Error("quantity must be non-zero");
        (err as { status?: number }).status = 400;
        throw err;
      }
      const unitPrice = item.unit_price;
      const discount = item.discount ?? 0;
      const priceOverride = item.price_override ?? null;
      const effectivePrice = priceOverride ?? unitPrice;

      if (item.is_bundle && item.bundle_id) {
        // ── Bundle: deduct stock for every sub-SKU ────────────────────
        const bRows = await sqlTx<Array<{ id: number; name: string; bundle_code: string }>>`
          SELECT id, name, bundle_code FROM product_bundles WHERE id = ${item.bundle_id}
        `;
        if (!bRows[0]) {
          const err = new Error(`Bundle id=${item.bundle_id} not found`);
          (err as { status?: number }).status = 400;
          throw err;
        }
        const bundle = bRows[0];
        const biRows = await sqlTx<Array<{ id: number; product_id: number; quantity: number }>>`
          SELECT id, product_id, quantity FROM bundle_items WHERE bundle_id = ${bundle.id}
        `;
        if (biRows.length === 0) {
          const err = new Error(`Bundle id=${bundle.id} has no items`);
          (err as { status?: number }).status = 400;
          throw err;
        }
        let anchorProductId: number | null = null;
        for (const bi of biRows) {
          const subRows = await sqlTx<Array<{ id: number; name: string; shop_id: string; stock: number; unit_price: string }>>`
            SELECT id, name, shop_id, stock, external_price AS unit_price
            FROM shop_products WHERE id = ${bi.product_id} FOR UPDATE
          `;
          const sub = subRows[0];
          if (!sub) {
            const err = new Error(`Bundle sub-product id=${bi.product_id} not found`);
            (err as { status?: number }).status = 400;
            throw err;
          }
          if (anchorProductId === null) anchorProductId = sub.id;
          const deductQty = bi.quantity * qty;
          const stockBefore = sub.stock;
          const sType = await lookupShopType(sub.shop_id);
          let stockAfter: number;
          if (sType === "fifo") {
            const r = await fifoDeductInTx(sqlTx, sub.id, deductQty, sub.shop_id);
            stockAfter = r.newStock;
            await sqlTx`UPDATE shop_products SET stock = ${r.newStock}, avg_cost = ${r.newAvgCost}, updated_at = NOW() WHERE id = ${sub.id}`;
          } else {
            stockAfter = stockBefore - deductQty;
            await sqlTx`UPDATE shop_products SET stock = ${stockAfter}, updated_at = NOW() WHERE id = ${sub.id}`;
          }
          await sqlTx`
            INSERT INTO shop_movements
              (date, product_id, product_name, shop_id, type, quantity, stock_before, stock_after,
               cost_per_unit, reference, note, created_by)
            VALUES (${today}, ${sub.id}, ${sub.name}, ${sub.shop_id}, ${movementType},
                    ${-deductQty}, ${stockBefore}, ${stockAfter},
                    ${pgNumber(sub.unit_price) ?? 0}, ${receiptNumber},
                    ${input.notes ?? null}, ${input.userId})
          `;
        }
        const lineTotal = Math.round((effectivePrice * qty - discount) * 100) / 100;
        subtotal += lineTotal;
        prepared.push({
          product_variant_id: anchorProductId!,
          quantity: qty,
          unit_price: unitPrice,
          price_override: priceOverride,
          discount,
          line_total: lineTotal,
          options: {
            is_bundle: true,
            bundle_id: bundle.id,
            bundle_name: bundle.name,
            bundle_code: bundle.bundle_code,
          },
        });
        auditLines.push({ name: bundle.name, qty, price: lineTotal });
        continue;
      }

      // ── Normal item ───────────────────────────────────────────────
      const prodRows = await sqlTx<Array<{ id: number; name: string; shop_id: string; stock: number }>>`
        SELECT id, name, shop_id, stock FROM shop_products
        WHERE id = ${item.product_variant_id} FOR UPDATE
      `;
      const product = prodRows[0];
      if (!product) {
        const err = new Error(`Product id=${item.product_variant_id} not found`);
        (err as { status?: number }).status = 400;
        throw err;
      }

      // Options resolution
      const { snapshot, optionsTotal } = await resolveOptions(product.id, item.options ?? []);
      const lineTotal = Math.round(((effectivePrice + optionsTotal) * qty - discount) * 100) / 100;
      subtotal += lineTotal;

      const stockBefore = product.stock;
      const pType = await lookupShopType(product.shop_id);
      let stockAfter: number;
      if (pType === "fifo") {
        const r = await fifoDeductInTx(sqlTx, product.id, qty, product.shop_id);
        stockAfter = r.newStock;
        await sqlTx`UPDATE shop_products SET stock = ${r.newStock}, avg_cost = ${r.newAvgCost}, updated_at = NOW() WHERE id = ${product.id}`;
      } else {
        stockAfter = stockBefore - qty;
        await sqlTx`UPDATE shop_products SET stock = ${stockAfter}, updated_at = NOW() WHERE id = ${product.id}`;
      }
      await sqlTx`
        INSERT INTO shop_movements
          (date, product_id, product_name, shop_id, type, quantity, stock_before, stock_after,
           cost_per_unit, reference, note, created_by)
        VALUES (${today}, ${product.id}, ${product.name}, ${product.shop_id}, ${movementType},
                ${-qty}, ${stockBefore}, ${stockAfter},
                ${unitPrice}, ${receiptNumber}, ${input.notes ?? null}, ${input.userId})
      `;

      prepared.push({
        product_variant_id: product.id,
        quantity: qty,
        unit_price: unitPrice,
        price_override: priceOverride,
        discount,
        line_total: lineTotal,
        options: snapshot,
      });
      auditLines.push({ name: product.name, qty, price: lineTotal });
    }

    const billDiscount = Math.max(0, Math.min(input.discount ?? 0, subtotal));
    const total = Math.round((subtotal - billDiscount) * 100) / 100;

    // ── Wallet deduction (department / user / customer) ──────────────
    let walletDeductData: {
      walletId: number;
      balanceBefore: number;
      balanceAfter: number;
      amount: number;
    } | null = null;
    let payerLabel: string | null = null;
    let payerEntityId: number | null = null;

    if (isDepartmentPayment) {
      if (!input.payer_department_id) {
        const err = new Error("Department charge requires payer_department_id");
        (err as { status?: number }).status = 400;
        throw err;
      }
      const wRows = await sqlTx<Array<{ id: number; balance: string }>>`
        SELECT id, balance FROM wallets WHERE department_id = ${input.payer_department_id} FOR UPDATE
      `;
      let walletId: number;
      let balanceBefore: number;
      if (!wRows[0]) {
        const ins = await sqlTx<Array<{ id: number }>>`
          INSERT INTO wallets (department_id, balance, is_active)
          VALUES (${input.payer_department_id}, 0, true) RETURNING id
        `;
        walletId = ins[0].id;
        balanceBefore = 0;
      } else {
        walletId = wRows[0].id;
        balanceBefore = Number(wRows[0].balance);
      }
      const balanceAfter = balanceBefore - total; // dept allows negative
      await sqlTx`UPDATE wallets SET balance = ${balanceAfter}, updated_at = NOW() WHERE id = ${walletId}`;
      walletDeductData = { walletId, balanceBefore, balanceAfter, amount: total };
      payerEntityId = input.payer_department_id ?? null;
      // dept name fetched lazily below if needed — skip to keep tx fast
    } else if (isWalletPayment && payerKind === "user" && input.payer_user_id !== null && input.payer_user_id !== undefined) {
      const wRows = await sqlTx<Array<{ id: number; balance: string }>>`
        SELECT id, balance FROM wallets WHERE user_id = ${input.payer_user_id} FOR UPDATE
      `;
      let walletId: number;
      let balanceBefore: number;
      if (!wRows[0]) {
        const ins = await sqlTx<Array<{ id: number }>>`
          INSERT INTO wallets (user_id, balance, is_active)
          VALUES (${input.payer_user_id}, 0, true) RETURNING id
        `;
        walletId = ins[0].id;
        balanceBefore = 0;
      } else {
        walletId = wRows[0].id;
        balanceBefore = Number(wRows[0].balance);
      }
      const projected = balanceBefore - total;
      if (!allowNegUser && projected < 0) {
        const err = new Error(
          `Insufficient wallet balance. Available: ฿${balanceBefore.toFixed(2)}, Required: ฿${total.toFixed(2)}`,
        );
        (err as { status?: number; code?: string }).status = 400;
        (err as { code?: string }).code = "INSUFFICIENT_USER_WALLET";
        throw err;
      }
      await sqlTx`UPDATE wallets SET balance = ${projected}, updated_at = NOW() WHERE id = ${walletId}`;
      walletDeductData = { walletId, balanceBefore, balanceAfter: projected, amount: total };
      payerEntityId = input.payer_user_id ?? null;
      const uRows = await sqlTx<Array<{ full_name: string | null; username: string }>>`SELECT full_name, username FROM users WHERE id = ${input.payer_user_id} LIMIT 1`;
      payerLabel = uRows[0]?.full_name ?? uRows[0]?.username ?? null;
    } else if (isWalletPayment && input.customer_id !== null && input.customer_id !== undefined) {
      const cRows = await sqlTx<Array<{ id: number; name: string; card_frozen: boolean; daily_limit: string | null; daily_limit_canteen: string | null; daily_limit_store: string | null; negative_credit_limit: string | null }>>`
        SELECT id, name, card_frozen, daily_limit, daily_limit_canteen, daily_limit_store, negative_credit_limit
        FROM customers WHERE id = ${input.customer_id}
      `;
      const customer = cRows[0];
      if (!customer) {
        const err = new Error(`Customer id=${input.customer_id} not found`);
        (err as { status?: number }).status = 400;
        throw err;
      }
      if (customer.card_frozen) {
        const err = new Error(`Card is frozen for ${customer.name}. Ask parent to unfreeze.`);
        (err as { status?: number }).status = 400;
        throw err;
      }
      const wRows = await sqlTx<Array<{ id: number; balance: string }>>`
        SELECT id, balance FROM wallets WHERE customer_id = ${input.customer_id} FOR UPDATE
      `;
      let walletId: number;
      let balanceBefore: number;
      if (!wRows[0]) {
        const ins = await sqlTx<Array<{ id: number }>>`
          INSERT INTO wallets (customer_id, balance, is_active)
          VALUES (${input.customer_id}, 0, true) RETURNING id
        `;
        walletId = ins[0].id;
        balanceBefore = 0;
      } else {
        walletId = wRows[0].id;
        balanceBefore = Number(wRows[0].balance);
      }
      // Daily limit check (per shop module)
      if (effectiveShopModule) {
        const isCanteen = effectiveShopModule === "canteen";
        const customLimit = isCanteen ? customer.daily_limit_canteen : customer.daily_limit_store;
        const effectiveLimit = customLimit !== null
          ? Number(customLimit)
          : (isCanteen ? DEFAULT_DAILY_LIMIT_CANTEEN : DEFAULT_DAILY_LIMIT_STORE);
        const todaySpent = await todayDeductedByModule(walletId, effectiveShopModule);
        if (todaySpent + total > effectiveLimit) {
          const remaining = Math.max(0, effectiveLimit - todaySpent);
          const groupName = isCanteen ? "Canteen" : "Store";
          const err = new Error(
            `Daily ${groupName} limit exceeded. Limit: ฿${effectiveLimit.toFixed(2)}, Spent: ฿${todaySpent.toFixed(2)}, Remaining: ฿${remaining.toFixed(2)}`,
          );
          (err as { status?: number }).status = 400;
          throw err;
        }
      }
      const projected = balanceBefore - total;
      if (!allowNegCustomer) {
        const maxOverdraft = customer.negative_credit_limit !== null
          ? Number(customer.negative_credit_limit)
          : 0;
        if (projected < -maxOverdraft) {
          const err = new Error(
            `Wallet would exceed negative credit limit. Available: ฿${balanceBefore.toFixed(2)}, Required: ฿${total.toFixed(2)}, Overdraft allowed: ฿${maxOverdraft.toFixed(2)}`,
          );
          (err as { status?: number; code?: string }).status = 400;
          (err as { code?: string }).code = "EXCEEDS_NEGATIVE_CREDIT_LIMIT";
          throw err;
        }
      }
      await sqlTx`UPDATE wallets SET balance = ${projected}, updated_at = NOW() WHERE id = ${walletId}`;
      walletDeductData = { walletId, balanceBefore, balanceAfter: projected, amount: total };
      payerLabel = customer.name;
      payerEntityId = input.customer_id ?? null;
      if (input.customer_id) {
        postCheckoutCustomerData = { customerId: input.customer_id, balanceAfter: projected };
      }
    }

    // ── Insert receipt + items ───────────────────────────────────────
    const receiptCustomerId = payerKind === "customer" && !isDepartmentPayment ? input.customer_id ?? null : null;
    const receiptPayerUserId = payerKind === "user" ? input.payer_user_id ?? null : null;
    const receiptPayerDeptId = isDepartmentPayment ? input.payer_department_id ?? null : null;

    const rIns = await sqlTx<Array<{ id: number }>>`
      INSERT INTO receipts
        (receipt_number, transaction_mode, payment_method,
         customer_id, payer_user_id, payer_department_id, requester_user_id,
         shop_id, subtotal, discount, tax, total, status,
         notes, edc_terminal_ref, edc_approval_code, edc_masked_card,
         cash_received, spending_group_id, created_by)
      VALUES (${receiptNumber}, ${transactionMode}, ${paymentMethod},
              ${receiptCustomerId}, ${receiptPayerUserId}, ${receiptPayerDeptId}, ${input.requester_user_id ?? null},
              ${effectiveShopId}, ${subtotal}, ${billDiscount}, 0, ${total}, 'ACTIVE',
              ${input.notes ?? null}, ${input.edc_terminal_ref ?? null},
              ${input.edc_approval_code ?? null}, ${input.edc_masked_card ?? null},
              ${paymentMethod === "CASH" ? input.cash_received ?? null : null},
              ${receiptSpendingGroupId}, ${input.userId})
      RETURNING id
    `;
    const receiptId = rIns[0].id;

    for (const ri of prepared) {
      await sqlTx`
        INSERT INTO receipt_items
          (receipt_id, product_variant_id, quantity, unit_price, price_override,
           discount, line_total, options)
        VALUES (${receiptId}, ${ri.product_variant_id}, ${ri.quantity}, ${ri.unit_price},
                ${ri.price_override}, ${ri.discount}, ${ri.line_total},
                ${ri.options !== null ? JSON.stringify(ri.options) : null}::jsonb)
      `;
    }

    if (walletDeductData) {
      await sqlTx`
        INSERT INTO wallet_transactions
          (wallet_id, transaction_type, amount, balance_before, balance_after,
           reference_type, reference_id, description, created_by)
        VALUES (${walletDeductData.walletId}, 'DEDUCTION', ${walletDeductData.amount},
                ${walletDeductData.balanceBefore}, ${walletDeductData.balanceAfter},
                'receipt', ${receiptId}, ${`Purchase at receipt ${receiptNumber}`}, ${input.userId})
      `;
    }

    // Audit
    await sqlTx`
      INSERT INTO audit_logs
        (entity_type, entity_id, entity_name, shop_id, action, user_id, changes_json)
      VALUES ('receipt', ${receiptId}, ${receiptNumber}, ${effectiveShopId}, 'CREATE',
              ${input.userId},
              ${JSON.stringify({
                payment_method: paymentMethod.toLowerCase(),
                total,
                items: prepared.length,
                products: auditLines,
                payer_kind: payerKind,
                payer_label: payerLabel,
                payer_id: payerEntityId,
              })}::jsonb)
    `;

    return receiptId;
  });

  const receipt = await getReceipt(newReceiptId);
  // Fire-and-forget — never block checkout response
  const notifyData = postCheckoutCustomerData as { customerId: number; balanceAfter: number } | null;
  if (notifyData) {
    checkAndSendLowBalanceAlerts(notifyData.customerId, notifyData.balanceAfter).catch(() => { });
  }
  return receipt;
}
