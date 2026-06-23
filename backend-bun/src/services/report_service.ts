import { and, eq, gte, lte, inArray, asc, desc, sql, ilike, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  receipts,
  receiptItems,
  shops,
  shopProducts,
  shopMovements,
  returnRequests,
  customers,
  customerTypes,
  users,
} from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";
import type { AccessTokenPayload } from "@/middleware/auth";

/**
 * Match the FastAPI helper: admins query any shop, others are clamped to
 * their own shop_id and 403 if they try to query someone else's.
 */
export interface CallerScope {
  is_superuser: boolean;
  role?: string;
  shop_id?: string | null;
  shop_module?: string | null;
}

export function scopeShop(user: AccessTokenPayload, shopId: string | null | undefined): string | null {
  if (user.is_superuser || user.roles.includes("admin")) return shopId ?? null;
  const own = (user as unknown as CallerScope).shop_id ?? null;
  if (shopId && shopId !== own) {
    const err = new Error("Not authorized for that shop");
    (err as { status?: number }).status = 403;
    throw err;
  }
  return own;
}

export function effectiveModule(user: AccessTokenPayload, module: string | null | undefined): string | null {
  if (user.is_superuser || user.roles.includes("admin")) return module ?? null;
  const own = user as unknown as CallerScope;
  if (own.shop_id) return null;
  return own.shop_module ?? module ?? null;
}

/** Asia/Bangkok-anchored ISO bounds for inclusive date filtering. */
export function dateRange(dateFrom: string, dateTo: string): { start: string; end: string } {
  return {
    start: `${dateFrom}T00:00:00+07:00`,
    end: `${dateTo}T23:59:59.999999+07:00`,
  };
}

async function moduleShopIds(module: string): Promise<string[]> {
  const rows = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.module, module), eq(shops.isActive, true)));
  return rows.map((r) => r.id);
}

// ── /sales ──────────────────────────────────────────────────────────────────

export interface SalesRow {
  product_name: string;
  quantity: number;
  total: number;
  shop_id: string;
  shop_name: string | null;
}

export interface SalesReport {
  date_from: string;
  date_to: string;
  shop_id: string | null;
  rows: SalesRow[];
  grand_total: number;
  receipt_count: number;
}

export async function salesReport(args: {
  user: AccessTokenPayload;
  dateFrom: string;
  dateTo: string;
  shopId?: string;
  module?: string;
}): Promise<SalesReport> {
  const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
  const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);
  const { start, end } = dateRange(args.dateFrom, args.dateTo);

  const receiptConds = [
    gte(receipts.transactionDate, start),
    lte(receipts.transactionDate, end),
    eq(receipts.status, "ACTIVE"),
  ];
  if (effectiveShopId) {
    receiptConds.push(eq(receipts.shopId, effectiveShopId));
  } else if (effMod) {
    const ids = await moduleShopIds(effMod);
    if (ids.length > 0) receiptConds.push(inArray(receipts.shopId, ids));
  }

  const receiptIdRows = await db
    .select({ id: receipts.id })
    .from(receipts)
    .where(and(...receiptConds));
  const receiptIds = receiptIdRows.map((r) => r.id);

  let rows: SalesRow[] = [];
  let grandTotal = 0;
  if (receiptIds.length > 0) {
    const agg = await db
      .select({
        name: shopProducts.name,
        qty: sql<string>`SUM(${receiptItems.quantity})`,
        total: sql<string>`SUM(${receiptItems.lineTotal})`,
        shop_id: shopProducts.shopId,
        shop_name: shops.name,
      })
      .from(receiptItems)
      .innerJoin(shopProducts, eq(shopProducts.id, receiptItems.productVariantId))
      .innerJoin(shops, eq(shops.id, shopProducts.shopId))
      .where(inArray(receiptItems.receiptId, receiptIds))
      .groupBy(shopProducts.shopId, shops.name, shopProducts.name)
      .orderBy(asc(shops.name), sql`SUM(${receiptItems.lineTotal}) DESC`);
    rows = agg.map((r) => {
      const total = pgNumber(r.total) ?? 0;
      grandTotal += total;
      return {
        product_name: r.name,
        quantity: Number(r.qty) || 0,
        total,
        shop_id: r.shop_id,
        shop_name: r.shop_name,
      };
    });
  }

  return {
    date_from: args.dateFrom,
    date_to: args.dateTo,
    shop_id: effectiveShopId,
    rows,
    grand_total: grandTotal,
    receipt_count: receiptIds.length,
  };
}

// ── /sales-by-payment ───────────────────────────────────────────────────────

export interface SalesByPaymentRow {
  payment_method: string;
  receipt_count: number;
  total: number;
  shop_id: string;
  shop_name: string | null;
}

export interface SalesByPaymentReport {
  date_from: string;
  date_to: string;
  shop_id: string | null;
  rows: SalesByPaymentRow[];
  grand_total: number;
  total_receipts: number;
  retail_total: number;
  department_total: number;
  department_receipts: number;
}

export async function salesByPaymentReport(args: {
  user: AccessTokenPayload;
  dateFrom: string;
  dateTo: string;
  shopId?: string;
  module?: string;
}): Promise<SalesByPaymentReport> {
  const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
  const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);
  const { start, end } = dateRange(args.dateFrom, args.dateTo);

  const conds = [
    gte(receipts.transactionDate, start),
    lte(receipts.transactionDate, end),
    eq(receipts.status, "ACTIVE"),
  ];
  if (effectiveShopId) {
    conds.push(eq(receipts.shopId, effectiveShopId));
  } else if (effMod) {
    const ids = await moduleShopIds(effMod);
    if (ids.length > 0) conds.push(inArray(receipts.shopId, ids));
  }

  const agg = await db
    .select({
      payment_method: receipts.paymentMethod,
      receipt_count: sql<string>`COUNT(${receipts.id})`,
      total: sql<string>`SUM(${receipts.total})`,
      shop_id: receipts.shopId,
      shop_name: shops.name,
    })
    .from(receipts)
    .innerJoin(shops, eq(shops.id, receipts.shopId))
    .where(and(...conds))
    .groupBy(receipts.shopId, shops.name, receipts.paymentMethod)
    .orderBy(asc(shops.name), sql`SUM(${receipts.total}) DESC`);

  let grand = 0;
  let totalRec = 0;
  let retail = 0;
  let dept = 0;
  let deptRec = 0;
  const rows: SalesByPaymentRow[] = agg.map((r) => {
    const total = pgNumber(r.total) ?? 0;
    const count = Number(r.receipt_count) || 0;
    grand += total;
    totalRec += count;
    if (r.payment_method === "DEPARTMENT") {
      dept += total;
      deptRec += count;
    } else {
      retail += total;
    }
    return {
      payment_method: r.payment_method,
      receipt_count: count,
      total,
      shop_id: r.shop_id ?? "",
      shop_name: r.shop_name,
    };
  });

  return {
    date_from: args.dateFrom,
    date_to: args.dateTo,
    shop_id: effectiveShopId,
    rows,
    grand_total: grand,
    total_receipts: totalRec,
    retail_total: retail,
    department_total: dept,
    department_receipts: deptRec,
  };
}

// ── /stock ──────────────────────────────────────────────────────────────────

export interface StockRow {
  product_code: string | null;
  product_name: string;
  stock_qty: number;
  shop_id: string;
  shop_name: string | null;
}

export interface StockReport {
  shop_id: string | null;
  rows: StockRow[];
}

export async function stockReport(args: {
  user: AccessTokenPayload;
  shopId?: string;
  module?: string;
}): Promise<StockReport> {
  const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
  const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);

  const conds = [eq(shopProducts.isActive, true)];
  if (effectiveShopId) {
    conds.push(eq(shopProducts.shopId, effectiveShopId));
  } else if (effMod) {
    conds.push(eq(shops.module, effMod));
  }

  const rows = await db
    .select({
      product_code: shopProducts.productCode,
      product_name: shopProducts.name,
      stock: shopProducts.stock,
      shop_id: shopProducts.shopId,
      shop_name: shops.name,
    })
    .from(shopProducts)
    .innerJoin(shops, eq(shops.id, shopProducts.shopId))
    .where(and(...conds))
    .orderBy(asc(shopProducts.shopId), asc(shopProducts.name));

  return {
    shop_id: effectiveShopId,
    rows: rows.map((r) => ({
      product_code: r.product_code,
      product_name: r.product_name,
      stock_qty: r.stock,
      shop_id: r.shop_id,
      shop_name: r.shop_name,
    })),
  };
}

// ── /returns ────────────────────────────────────────────────────────────────

export interface ReturnRow {
  id: number;
  return_date: string;
  receipt_number: string;
  product_name: string;
  quantity: number;
  refund_amount: number;
  exchange_amount: number;
  status: string;
}

export interface ReturnReport {
  date_from: string;
  date_to: string;
  shop_id: string | null;
  rows: ReturnRow[];
  total_refund: number;
  total_exchange: number;
}

export async function returnsReport(args: {
  user: AccessTokenPayload;
  dateFrom: string;
  dateTo: string;
  shopId?: string;
  module?: string;
}): Promise<ReturnReport> {
  const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
  const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);
  const { start, end } = dateRange(args.dateFrom, args.dateTo);

  let allowedReceiptNumbers: Set<string> | null = null;
  if (effectiveShopId) {
    const rows = await db
      .select({ rn: receipts.receiptNumber })
      .from(receipts)
      .where(eq(receipts.shopId, effectiveShopId));
    allowedReceiptNumbers = new Set(rows.map((r) => r.rn));
  } else if (effMod) {
    const ids = await moduleShopIds(effMod);
    if (ids.length > 0) {
      const rows = await db
        .select({ rn: receipts.receiptNumber })
        .from(receipts)
        .where(inArray(receipts.shopId, ids));
      allowedReceiptNumbers = new Set(rows.map((r) => r.rn));
    } else {
      allowedReceiptNumbers = new Set();
    }
  }

  const rrRows = await db
    .select()
    .from(returnRequests)
    .where(and(gte(returnRequests.createdAt, start), lte(returnRequests.createdAt, end)))
    .orderBy(desc(returnRequests.createdAt));

  const filtered = allowedReceiptNumbers
    ? rrRows.filter((r) => allowedReceiptNumbers!.has(r.receiptId))
    : rrRows;

  let totalRefund = 0;
  let totalExchange = 0;
  const rows: ReturnRow[] = filtered.map((r) => {
    const refund = pgNumber(r.refundAmount) ?? 0;
    const exch = pgNumber(r.exchangeAmount) ?? 0;
    totalRefund += refund;
    totalExchange += exch;
    return {
      id: r.id,
      return_date: pgToIso(r.createdAt)!,
      receipt_number: r.receiptId, // historical mis-naming preserved
      product_name: r.productName,
      quantity: r.returnQuantity,
      refund_amount: refund,
      exchange_amount: exch,
      status: r.status,
    };
  });

  return {
    date_from: args.dateFrom,
    date_to: args.dateTo,
    shop_id: effectiveShopId,
    rows,
    total_refund: totalRefund,
    total_exchange: totalExchange,
  };
}

// ── /stock-card ─────────────────────────────────────────────────────────────

export interface StockCardRowDTO {
  date: string | null;
  description: string;
  invoice_no: string | null;
  qty_in: number;
  qty_out: number;
  qty_balance: number;
  amount_in: number;
  amount_out: number;
  cost_per_unit: number;
  amount_balance: number;
}

export interface StockCardProductBlockDTO {
  product_variant_id: number;
  product_code: string;
  product_name: string;
  rows: StockCardRowDTO[];
  total_qty_in: number;
  total_qty_out: number;
  total_amount_in: number;
  total_amount_out: number;
}

export interface StockCardReportDTO {
  shop_id: string | null;
  shop_name: string | null;
  date_from: string;
  date_to: string;
  products: StockCardProductBlockDTO[];
}

const MOVEMENT_DESCRIPTION: Record<string, string> = {
  receive: "Receive",
  sale: "Sales",
  adjustment: "Adjustment",
  internal_use: "Internal Use",
  void: "Return",
  exchange: "Exchange",
};

async function buildProductBlock(
  product: typeof shopProducts.$inferSelect,
  dateFrom: string,
  dateTo: string,
): Promise<StockCardProductBlockDTO> {
  const startBkk = `${dateFrom}T00:00:00+07:00`;
  const { end } = dateRange(dateFrom, dateTo);

  const lastBeforeRows = await db
    .select()
    .from(shopMovements)
    .where(and(eq(shopMovements.productId, product.id), sql`${shopMovements.createdAt} < ${startBkk}`))
    .orderBy(desc(shopMovements.createdAt))
    .limit(1);
  const lastBefore = lastBeforeRows[0];

  const openingQty = lastBefore ? lastBefore.stockAfter : product.stock;
  const openingCost =
    lastBefore && lastBefore.costPerUnit !== null
      ? pgNumber(lastBefore.costPerUnit) ?? 0
      : pgNumber(product.avgCost) ?? 0;

  const movements = await db
    .select()
    .from(shopMovements)
    .where(
      and(
        eq(shopMovements.productId, product.id),
        gte(shopMovements.createdAt, startBkk),
        lte(shopMovements.createdAt, end),
      ),
    )
    .orderBy(asc(shopMovements.createdAt));

  const rows: StockCardRowDTO[] = [
    {
      date: null,
      description: "Beginning Balance",
      invoice_no: null,
      qty_in: 0,
      qty_out: 0,
      qty_balance: openingQty,
      amount_in: 0,
      amount_out: 0,
      cost_per_unit: openingCost,
      amount_balance: Math.round(openingQty * openingCost * 100) / 100,
    },
  ];

  let totalQtyIn = 0;
  let totalQtyOut = 0;
  let totalAmountIn = 0;
  let totalAmountOut = 0;
  let lastCost = openingCost;

  for (const m of movements) {
    const typeStr = m.type;
    const signed = m.quantity;
    const cost = m.costPerUnit !== null ? pgNumber(m.costPerUnit) ?? lastCost : lastCost;
    const qtyIn = signed >= 0 ? signed : 0;
    const qtyOut = signed < 0 ? -signed : 0;
    const amountIn = Math.round(qtyIn * cost * 100) / 100;
    const amountOut = Math.round(qtyOut * cost * 100) / 100;
    const balance = m.stockAfter;
    rows.push({
      date: pgToIso(m.createdAt),
      description: MOVEMENT_DESCRIPTION[typeStr] ?? typeStr,
      invoice_no: m.reference ?? null,
      qty_in: qtyIn,
      qty_out: qtyOut,
      qty_balance: balance,
      amount_in: amountIn,
      amount_out: amountOut,
      cost_per_unit: cost,
      amount_balance: Math.round(balance * cost * 100) / 100,
    });
    totalQtyIn += qtyIn;
    totalQtyOut += qtyOut;
    totalAmountIn += amountIn;
    totalAmountOut += amountOut;
    lastCost = cost;
  }

  const closingQty = movements.length > 0 ? movements[movements.length - 1].stockAfter : openingQty;
  rows.push({
    date: null,
    description: "Closing Balance",
    invoice_no: null,
    qty_in: 0,
    qty_out: 0,
    qty_balance: closingQty,
    amount_in: 0,
    amount_out: 0,
    cost_per_unit: lastCost,
    amount_balance: Math.round(closingQty * lastCost * 100) / 100,
  });

  return {
    product_variant_id: product.id,
    product_code: product.productCode ?? "",
    product_name: product.name,
    rows,
    total_qty_in: totalQtyIn,
    total_qty_out: totalQtyOut,
    total_amount_in: Math.round(totalAmountIn * 100) / 100,
    total_amount_out: Math.round(totalAmountOut * 100) / 100,
  };
}

export async function stockCardReport(args: {
  user: AccessTokenPayload;
  dateFrom: string;
  dateTo: string;
  shopId?: string;
  productVariantId?: number;
  productSearch?: string;
  category?: string;
  includeEmpty?: boolean;
}): Promise<StockCardReportDTO> {
  const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
  if (!effectiveShopId) {
    const err = new Error("shop_id is required for stock card report");
    (err as { status?: number }).status = 400;
    throw err;
  }

  const shopRows = await db
    .select({ id: shops.id, name: shops.name })
    .from(shops)
    .where(eq(shops.id, effectiveShopId))
    .limit(1);
  if (!shopRows[0]) {
    const err = new Error("Shop not found");
    (err as { status?: number }).status = 404;
    throw err;
  }

  const productConds = [eq(shopProducts.shopId, effectiveShopId)];
  if (args.productVariantId !== undefined) productConds.push(eq(shopProducts.id, args.productVariantId));
  if (args.productSearch) {
    const like = `%${args.productSearch}%`;
    productConds.push(or(ilike(shopProducts.name, like), ilike(shopProducts.productCode, like))!);
  }
  if (args.category) productConds.push(eq(shopProducts.category, args.category));

  process.stdout.write(`[SC] productSearch=${JSON.stringify(args.productSearch)} conds=${productConds.length}\n`);

  const productsRows = await db
    .select()
    .from(shopProducts)
    .where(and(...productConds))
    .orderBy(asc(shopProducts.name));

  process.stdout.write(`[SC] db returned ${productsRows.length} rows\n`);

  let products = await Promise.all(productsRows.map((p) => buildProductBlock(p, args.dateFrom, args.dateTo)));
  // In-memory fallback filter (in case DB ILIKE didn't apply)
  if (args.productSearch) {
    const term = args.productSearch.toLowerCase();
    products = products.filter((b) =>
      b.product_code.toLowerCase().includes(term) || b.product_name.toLowerCase().includes(term),
    );
    process.stdout.write(`[SC] after in-memory filter: ${products.length} products (term=${JSON.stringify(term)})\n`);
  }
  if (!args.includeEmpty) {
    products = products.filter((b) => b.rows.length > 2);
  }

  return {
    shop_id: effectiveShopId,
    shop_name: shopRows[0].name,
    date_from: args.dateFrom,
    date_to: args.dateTo,
    products,
  };
}

// ── /sales-summary + /sales-by-item ────────────────────────────────────────

const RECEIVE_TYPE_GROUPS: Record<string, string[]> = {
  cash: ["CASH"],
  wallet: ["WALLET", "CARD_TAP"],
  credit: ["CREDIT_CARD", "DEBIT_CARD", "EDC"],
  qr: ["BANK_TRANSFER"],
  department: ["DEPARTMENT"],
  other: ["OTHER"],
};

function amountColumnFor(method: string): string {
  if (method === "CASH") return "amt_cash";
  if (method === "WALLET" || method === "CARD_TAP") return "amt_campus_card";
  if (method === "CREDIT_CARD" || method === "DEBIT_CARD" || method === "EDC") return "amt_credit_card";
  if (method === "BANK_TRANSFER") return "amt_qr_code";
  if (method === "DEPARTMENT") return "amt_billing";
  return "amt_other";
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  WALLET: "Campus Card",
  CARD_TAP: "Campus Card",
  CREDIT_CARD: "Credit Card",
  DEBIT_CARD: "Credit Card",
  EDC: "Credit Card",
  BANK_TRANSFER: "QR Code",
  DEPARTMENT: "Department",
  OTHER: "Other",
};

export interface SalesSummaryRow {
  seq: number;
  transaction_date: string;
  receipt_number: string;
  customer_id: string | null;
  customer_name: string | null;
  amt_receive: number;
  amt_change: number;
  amt_billing: number;
  amt_cash: number;
  amt_campus_card: number;
  amt_credit_card: number;
  amt_qr_code: number;
  amt_other: number;
  remark: string | null;
  shop_id: string;
  shop_name: string | null;
}

export interface SalesSummaryTotals {
  amt_receive: number;
  amt_change: number;
  amt_billing: number;
  amt_cash: number;
  amt_campus_card: number;
  amt_credit_card: number;
  amt_qr_code: number;
  amt_other: number;
}

export interface SalesSummaryReport {
  date_from: string | null;
  date_to: string | null;
  shop_id: string | null;
  rows: SalesSummaryRow[];
  totals: SalesSummaryTotals;
  receipt_count: number;
}

export async function salesSummaryReport(args: {
  user: AccessTokenPayload;
  dateFrom?: string | null;
  dateTo?: string | null;
  customerType?: string;
  userName?: string;
  familyCode?: string;
  receiptNoFrom?: string;
  receiptNoTo?: string;
  receiveType?: string;
  shopId?: string;
  module?: string;
}): Promise<SalesSummaryReport> {
  const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
  const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);

  const conds = [eq(receipts.status, "ACTIVE")];
  if (args.dateFrom) conds.push(gte(receipts.transactionDate, `${args.dateFrom}T00:00:00+07:00`));
  if (args.dateTo) conds.push(lte(receipts.transactionDate, `${args.dateTo}T23:59:59.999999+07:00`));
  if (effectiveShopId) {
    conds.push(eq(receipts.shopId, effectiveShopId));
  } else if (effMod) {
    const ids = await moduleShopIds(effMod);
    if (ids.length > 0) conds.push(inArray(receipts.shopId, ids));
  }
  if (args.receiptNoFrom) conds.push(gte(receipts.receiptNumber, args.receiptNoFrom));
  if (args.receiptNoTo) conds.push(lte(receipts.receiptNumber, args.receiptNoTo));
  if (args.receiveType && args.receiveType !== "all") {
    const methods = RECEIVE_TYPE_GROUPS[args.receiveType];
    if (methods) conds.push(inArray(receipts.paymentMethod, methods));
  }

  // Use a single query with left-joins so optional customer filters work without
  // dropping guest sales when not filtered.
  const baseQuery = db
    .select({
      receipt: receipts,
      customer: customers,
      payer: users,
      shop: shops,
    })
    .from(receipts)
    .leftJoin(customers, eq(customers.id, receipts.customerId))
    .leftJoin(users, eq(users.id, receipts.payerUserId))
    .leftJoin(shops, eq(shops.id, receipts.shopId));

  const filterConds = [...conds];
  if (args.customerType && args.customerType !== "all") {
    filterConds.push(
      sql`EXISTS (SELECT 1 FROM ${customerTypes} ct WHERE ct.id = ${customers.customerTypeId} AND ct.type_name = ${args.customerType})`,
    );
  }
  if (args.familyCode) filterConds.push(eq(customers.familyCode, args.familyCode));
  if (args.userName) {
    const pat = `%${args.userName}%`;
    filterConds.push(or(ilike(customers.name, pat), ilike(users.fullName, pat))!);
  }

  const allRows = await baseQuery
    .where(and(...filterConds))
    .orderBy(asc(shops.name), asc(receipts.transactionDate), asc(receipts.id));

  const rows: SalesSummaryRow[] = [];
  const totals: SalesSummaryTotals = {
    amt_receive: 0,
    amt_change: 0,
    amt_billing: 0,
    amt_cash: 0,
    amt_campus_card: 0,
    amt_credit_card: 0,
    amt_qr_code: 0,
    amt_other: 0,
  };

  allRows.forEach(({ receipt: r, customer, payer, shop }, idx) => {
    const amtReceive = pgNumber(r.total) ?? 0;
    let amtChange = 0;
    if (r.paymentMethod === "CASH" && r.cashReceived !== null) {
      const cashReceived = pgNumber(r.cashReceived) ?? 0;
      amtChange = Math.max(cashReceived - amtReceive, 0);
    }

    let custId: string | null = null;
    let custName: string | null = null;
    if (customer) {
      custId = customer.customerCode;
      custName = customer.name;
    } else if (payer) {
      custId = payer.externalId ?? payer.username;
      custName = payer.fullName;
    }

    const col = amountColumnFor(r.paymentMethod) as keyof SalesSummaryTotals;
    const buckets: Omit<
      SalesSummaryRow,
      "seq" | "transaction_date" | "receipt_number" | "customer_id" | "customer_name" | "amt_receive" | "amt_change" | "remark" | "shop_id" | "shop_name"
    > = {
      amt_billing: 0,
      amt_cash: 0,
      amt_campus_card: 0,
      amt_credit_card: 0,
      amt_qr_code: 0,
      amt_other: 0,
    };
    (buckets as Record<string, number>)[col] = amtReceive;

    rows.push({
      seq: idx + 1,
      transaction_date: pgToIso(r.transactionDate)!,
      receipt_number: r.receiptNumber,
      customer_id: custId,
      customer_name: custName,
      amt_receive: amtReceive,
      amt_change: amtChange,
      remark: r.notes ?? null,
      shop_id: r.shopId ?? "",
      shop_name: shop?.name ?? null,
      ...buckets,
    });

    totals.amt_receive += amtReceive;
    totals.amt_change += amtChange;
    (totals as Record<string, number>)[col] += amtReceive;
  });

  return {
    date_from: args.dateFrom ?? null,
    date_to: args.dateTo ?? null,
    shop_id: effectiveShopId,
    rows,
    totals,
    receipt_count: rows.length,
  };
}

export interface SalesByItemRow {
  seq: number;
  transaction_date: string;
  item_no: string | null;
  item_name: string;
  receipt_number: string;
  customer_id: string | null;
  customer_name: string | null;
  sales_qty: number;
  sales_amt: number;
  receive_type: string;
  remark: string | null;
}

export interface SalesByItemTotals {
  sales_qty: number;
  sales_amt: number;
}

export interface SalesByItemReport {
  date_from: string | null;
  date_to: string | null;
  shop_id: string | null;
  rows: SalesByItemRow[];
  totals: SalesByItemTotals;
  line_count: number;
}

export async function salesByItemReport(args: {
  user: AccessTokenPayload;
  dateFrom?: string | null;
  dateTo?: string | null;
  customerType?: string;
  userName?: string;
  familyCode?: string;
  receiptNoFrom?: string;
  receiptNoTo?: string;
  receiveType?: string;
  shopId?: string;
  module?: string;
}): Promise<SalesByItemReport> {
  const effectiveShopId = scopeShop(args.user, args.shopId ?? null);
  const effMod = effectiveShopId ? null : effectiveModule(args.user, args.module ?? null);

  const conds = [eq(receipts.status, "ACTIVE")];
  if (args.dateFrom) conds.push(gte(receipts.transactionDate, `${args.dateFrom}T00:00:00+07:00`));
  if (args.dateTo) conds.push(lte(receipts.transactionDate, `${args.dateTo}T23:59:59.999999+07:00`));
  if (effectiveShopId) {
    conds.push(eq(receipts.shopId, effectiveShopId));
  } else if (effMod) {
    const ids = await moduleShopIds(effMod);
    if (ids.length > 0) conds.push(inArray(receipts.shopId, ids));
  }
  if (args.receiptNoFrom) conds.push(gte(receipts.receiptNumber, args.receiptNoFrom));
  if (args.receiptNoTo) conds.push(lte(receipts.receiptNumber, args.receiptNoTo));
  if (args.receiveType && args.receiveType !== "all") {
    const methods = RECEIVE_TYPE_GROUPS[args.receiveType];
    if (methods) conds.push(inArray(receipts.paymentMethod, methods));
  }
  if (args.familyCode) conds.push(eq(customers.familyCode, args.familyCode));
  if (args.userName) {
    const pat = `%${args.userName}%`;
    conds.push(or(ilike(customers.name, pat), ilike(users.fullName, pat))!);
  }

  const joined = await db
    .select({
      receipt: receipts,
      item: receiptItems,
      product: shopProducts,
      customer: customers,
      payer: users,
    })
    .from(receiptItems)
    .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
    .leftJoin(shopProducts, eq(shopProducts.id, receiptItems.productVariantId))
    .leftJoin(customers, eq(customers.id, receipts.customerId))
    .leftJoin(users, eq(users.id, receipts.payerUserId))
    .where(and(...conds))
    .orderBy(asc(receipts.transactionDate), asc(receipts.id), asc(receiptItems.id));

  const rows: SalesByItemRow[] = [];
  const totals: SalesByItemTotals = { sales_qty: 0, sales_amt: 0 };

  joined.forEach(({ receipt: r, item, product, customer, payer }, idx) => {
    const qty = item.quantity;
    const amt = pgNumber(item.lineTotal) ?? 0;
    let custId: string | null = null;
    let custName: string | null = null;
    if (customer) {
      custId = customer.customerCode;
      custName = customer.name;
    } else if (payer) {
      custId = payer.externalId ?? payer.username;
      custName = payer.fullName;
    }
    rows.push({
      seq: idx + 1,
      transaction_date: pgToIso(r.transactionDate)!,
      item_no: product?.productCode ?? null,
      item_name: product?.name ?? "(unknown)",
      receipt_number: r.receiptNumber,
      customer_id: custId,
      customer_name: custName,
      sales_qty: qty,
      sales_amt: amt,
      receive_type: PAYMENT_METHOD_LABEL[r.paymentMethod] ?? "Other",
      remark: r.notes ?? null,
    });
    totals.sales_qty += qty;
    totals.sales_amt += amt;
  });

  return {
    date_from: args.dateFrom ?? null,
    date_to: args.dateTo ?? null,
    shop_id: effectiveShopId,
    rows,
    totals,
    line_count: rows.length,
  };
}
