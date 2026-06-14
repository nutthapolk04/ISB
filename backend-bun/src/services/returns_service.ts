import { and, desc, eq, ilike, ne, or, sql, isNull } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import { returnRequests, receipts, shopProducts } from "@/db/schema";
import { pgNumber } from "@/lib/dates";
import { fifoRefundLot, fifoDeductInTx } from "@/services/inventory_fifo";

export interface ReturnRequestDTO {
  id: number;
  receiptId: string;
  productCode: string | null;
  productName: string;
  bundleId: number | null;
  quantity: number;
  returnQuantity: number;
  reason: string;
  status: string;
  date: string;
  priceType: string;
  voidStatus: string;
  returnStatus: string;
}

export interface ReturnHistoryDTO {
  id: string;
  date: string;
  receiptId: string;
  studentId: string;
  studentName: string;
  returnedItems: string[];
  exchangedItems: string[];
  returnValue: number;
  exchangeValue: number;
  difference: number;
  status: string;
  reason: string;
}

function rrToDto(rr: typeof returnRequests.$inferSelect): ReturnRequestDTO {
  return {
    id: rr.id,
    receiptId: rr.receiptId,
    productCode: rr.productCode ?? null,
    productName: rr.productName,
    bundleId: rr.bundleId ?? null,
    quantity: rr.quantity,
    returnQuantity: rr.returnQuantity,
    reason: rr.reason,
    status: rr.status,
    date: rr.createdAt ? rr.createdAt.slice(0, 10) : "",
    priceType: rr.priceType ?? "normal",
    voidStatus: rr.voidStatus ?? "active",
    returnStatus: rr.returnStatus ?? "no-return",
  };
}

export async function listReturns(args: { q?: string; shopId?: string | null }): Promise<ReturnRequestDTO[]> {
  if (args.shopId) {
    // Join receipt by receipt_number to derive shop scope.
    const conds = [eq(receipts.shopId, args.shopId)];
    if (args.q?.trim()) {
      const pat = `%${args.q.trim()}%`;
      conds.push(or(ilike(returnRequests.receiptId, pat), ilike(returnRequests.productName, pat))!);
    }
    const rows = await db
      .select({ rr: returnRequests })
      .from(returnRequests)
      .innerJoin(receipts, eq(receipts.receiptNumber, returnRequests.receiptId))
      .where(and(...conds))
      .orderBy(desc(returnRequests.createdAt));
    return rows.map((r) => rrToDto(r.rr));
  }
  const conds = [];
  if (args.q?.trim()) {
    const pat = `%${args.q.trim()}%`;
    conds.push(or(ilike(returnRequests.receiptId, pat), ilike(returnRequests.productName, pat))!);
  }
  const rows = await db
    .select()
    .from(returnRequests)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(returnRequests.createdAt));
  return rows.map(rrToDto);
}

export async function getReturnsByReceipt(receiptNumber: string, shopId?: string | null): Promise<ReturnRequestDTO[]> {
  if (shopId) {
    const rows = await db
      .select({ rr: returnRequests })
      .from(returnRequests)
      .innerJoin(receipts, eq(receipts.receiptNumber, returnRequests.receiptId))
      .where(and(eq(returnRequests.receiptId, receiptNumber), ne(returnRequests.status, "rejected"), eq(receipts.shopId, shopId)))
      .orderBy(desc(returnRequests.createdAt));
    return rows.map((r) => rrToDto(r.rr));
  }
  const rows = await db
    .select()
    .from(returnRequests)
    .where(and(eq(returnRequests.receiptId, receiptNumber), ne(returnRequests.status, "rejected")))
    .orderBy(desc(returnRequests.createdAt));
  return rows.map(rrToDto);
}

export async function getReturn(returnId: number): Promise<ReturnRequestDTO> {
  const rows = await db.select().from(returnRequests).where(eq(returnRequests.id, returnId)).limit(1);
  if (!rows[0]) {
    const err = new Error("Return request not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  return rrToDto(rows[0]);
}

export async function getReturnHistory(args: { q?: string; shopId?: string | null }): Promise<ReturnHistoryDTO[]> {
  if (args.shopId) {
    const conds = [ne(returnRequests.status, "pending"), eq(receipts.shopId, args.shopId)];
    if (args.q?.trim()) {
      const pat = `%${args.q.trim()}%`;
      conds.push(or(ilike(returnRequests.receiptId, pat), ilike(returnRequests.productName, pat))!);
    }
    const rows = await db
      .select({ rr: returnRequests })
      .from(returnRequests)
      .innerJoin(receipts, eq(receipts.receiptNumber, returnRequests.receiptId))
      .where(and(...conds))
      .orderBy(desc(returnRequests.processedAt));
    return rows.map((r) => toHistoryDto(r.rr));
  }
  const conds = [ne(returnRequests.status, "pending")];
  if (args.q?.trim()) {
    const pat = `%${args.q.trim()}%`;
    conds.push(or(ilike(returnRequests.receiptId, pat), ilike(returnRequests.productName, pat))!);
  }
  const rows = await db
    .select()
    .from(returnRequests)
    .where(and(...conds))
    .orderBy(desc(returnRequests.processedAt));
  return rows.map(toHistoryDto);
}

// ── Writes ─────────────────────────────────────────────────────────────

export interface ReturnItemInput {
  productCode: string;
  productName: string;
  quantity: number;
  returnQuantity: number;
  price: number;
  bundleId?: number | null;
}

export async function createReturn(args: {
  receiptId: string;
  items: ReturnItemInput[];
  reason: string;
  userId: number;
}): Promise<ReturnRequestDTO[]> {
  const created: ReturnRequestDTO[] = [];

  for (const item of args.items) {
    const purchasedQty = item.quantity;
    const requestedQty = item.returnQuantity;
    const bundleIdIn = item.bundleId ?? null;

    const conds = [
      eq(returnRequests.receiptId, args.receiptId),
      eq(returnRequests.productCode, item.productCode),
      ne(returnRequests.status, "rejected"),
    ];
    if (bundleIdIn !== null) conds.push(eq(returnRequests.bundleId, bundleIdIn));
    else conds.push(isNull(returnRequests.bundleId));

    const existing = await db
      .select({ returnQuantity: returnRequests.returnQuantity })
      .from(returnRequests)
      .where(and(...conds));
    const alreadyReturned = existing.reduce((s, r) => s + r.returnQuantity, 0);
    const remaining = purchasedQty - alreadyReturned;

    if (remaining <= 0) {
      const err = new Error(
        `Product '${item.productCode}' from receipt '${args.receiptId}' has already been fully returned (${alreadyReturned}/${purchasedQty})`,
      );
      (err as { status?: number }).status = 409;
      throw err;
    }
    if (requestedQty > remaining) {
      const err = new Error(
        `Product '${item.productCode}': requested ${requestedQty} but only ${remaining} remaining (purchased ${purchasedQty}, already returned ${alreadyReturned})`,
      );
      (err as { status?: number }).status = 409;
      throw err;
    }

    const totalAfter = alreadyReturned + requestedQty;
    const [inserted] = await db
      .insert(returnRequests)
      .values({
        receiptId: args.receiptId,
        productCode: item.productCode,
        productName: item.productName,
        bundleId: bundleIdIn,
        quantity: purchasedQty,
        returnQuantity: requestedQty,
        price: String(item.price ?? 0),
        reason: args.reason,
        status: "pending",
        returnStatus: totalAfter >= purchasedQty ? "full-return" : "partial-return",
        createdBy: args.userId,
      })
      .returning();
    created.push(rrToDto(inserted));
  }

  return created;
}

export interface ReturnWithoutReceiptItemInput {
  productCode: string;
  productName: string;
  returnQuantity: number;
  unitPrice: number;
  shopId: string;
}

export async function createReturnWithoutReceipt(args: {
  items: ReturnWithoutReceiptItemInput[];
  reason: string;
  customerName?: string | null;
  notes?: string | null;
  userId: number;
}): Promise<ReturnRequestDTO[]> {
  const created: ReturnRequestDTO[] = [];
  const noReceiptId = `NO-RCPT-${Math.floor(Date.now() / 1000)}`;

  for (const item of args.items) {
    const productRows = await db
      .select({ id: shopProducts.id })
      .from(shopProducts)
      .where(and(
        eq(shopProducts.productCode, item.productCode),
        eq(shopProducts.shopId, item.shopId),
        eq(shopProducts.isActive, true),
      ))
      .limit(1);
    if (!productRows[0]) {
      const err = new Error(`Product '${item.productCode}' not found in shop '${item.shopId}'`);
      (err as { status?: number }).status = 400;
      throw err;
    }

    let fullReason = args.reason;
    if (args.customerName) fullReason = `${fullReason} (Customer: ${args.customerName})`;
    if (args.notes) fullReason = `${fullReason} | Notes: ${args.notes}`;

    const [inserted] = await db
      .insert(returnRequests)
      .values({
        receiptId: noReceiptId,
        productCode: item.productCode,
        productName: item.productName,
        quantity: item.returnQuantity,
        returnQuantity: item.returnQuantity,
        price: String(item.unitPrice ?? 0),
        reason: fullReason,
        status: "pending",
        returnStatus: "full-return",
        createdBy: args.userId,
      })
      .returning();
    created.push(rrToDto(inserted));
  }
  return created;
}

export interface UpdateReturnInput {
  productName?: string | null;
  quantity?: number | null;
  returnQuantity?: number | null;
  reason?: string | null;
  status?: string | null;
  priceType?: string | null;
}

export async function updateReturn(returnId: number, input: UpdateReturnInput): Promise<ReturnRequestDTO> {
  const rows = await db.select().from(returnRequests).where(eq(returnRequests.id, returnId)).limit(1);
  if (!rows[0]) {
    const err = new Error("Return request not found");
    (err as { status?: number }).status = 404;
    throw err;
  }

  const updates: Record<string, unknown> = {};
  if (input.productName !== undefined && input.productName !== null) updates.productName = input.productName;
  if (input.quantity !== undefined && input.quantity !== null) updates.quantity = input.quantity;
  if (input.returnQuantity !== undefined && input.returnQuantity !== null) updates.returnQuantity = input.returnQuantity;
  if (input.reason !== undefined && input.reason !== null) updates.reason = input.reason;
  if (input.status !== undefined && input.status !== null) updates.status = input.status;
  if (input.priceType !== undefined && input.priceType !== null) updates.priceType = input.priceType;

  if (Object.keys(updates).length > 0) {
    await db.update(returnRequests).set(updates).where(eq(returnRequests.id, returnId));
  }
  const fresh = await db.select().from(returnRequests).where(eq(returnRequests.id, returnId)).limit(1);
  return rrToDto(fresh[0]);
}

export async function deleteReturn(returnId: number): Promise<void> {
  const rows = await db.select({ id: returnRequests.id }).from(returnRequests).where(eq(returnRequests.id, returnId)).limit(1);
  if (!rows[0]) {
    const err = new Error("Return request not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  await db.delete(returnRequests).where(eq(returnRequests.id, returnId));
}

// ── Process refund (atomic stock restore + wallet refund) ──────────────

export interface RefundResultDTO {
  id: string;
  refundAmount: number;
  refundMethod: string;
  refundedTo: Record<string, unknown>;
  status: string;
  timestamp: string;
}

export interface ExchangeItemInput {
  productCode: string;
  quantity: number;
}

export interface ExchangeResultDTO {
  id: string;
  returnValue: number;
  exchangeValue: number;
  difference: number;
  status: string;
  timestamp: string;
}

const PAYMENT_METHOD_WALLET = new Set(["WALLET", "CARD_TAP", "DEPARTMENT"]);
const PAYMENT_METHOD_CARD = new Set(["EDC", "CREDIT_CARD", "DEBIT_CARD"]);

export async function processRefund(args: {
  returnId: number;
  reason: string;
  notes?: string | null;
  userId: number;
}): Promise<RefundResultDTO> {
  // Eager load — return + linked receipt
  const rrRows = await db.select().from(returnRequests).where(eq(returnRequests.id, args.returnId)).limit(1);
  if (!rrRows[0]) {
    const err = new Error(`Return request ${args.returnId} not found`);
    (err as { status?: number }).status = 404;
    throw err;
  }
  const rr = rrRows[0];

  const refundAmount = (pgNumber(rr.price) ?? 0) * rr.returnQuantity;

  // Lookup receipt by receipt_number (rr.receipt_id stores the receipt_number string)
  const recRows = await db.select().from(receipts).where(eq(receipts.receiptNumber, rr.receiptId)).limit(1);
  const receipt = recRows[0];

  // Pre-load bundle items if bundle return
  let bundleItemRows: Array<{ product_id: number; quantity: number }> = [];
  if (rr.bundleId !== null) {
    const rows = await db
      .select({ product_id: sql<number>`product_id`, quantity: sql<number>`quantity` })
      .from(sql`bundle_items`)
      .where(sql`bundle_id = ${rr.bundleId}`);
    bundleItemRows = rows as Array<{ product_id: number; quantity: number }>;
  }

  // Pre-resolve non-bundle product
  let normalProductId: number | null = null;
  if (rr.bundleId === null) {
    const pr = await db.select({ id: shopProducts.id }).from(shopProducts).where(eq(shopProducts.productCode, rr.productCode ?? "")).limit(1);
    if (pr[0]) normalProductId = pr[0].id;
  }

  const today = new Date().toISOString().slice(0, 10);
  let derivedMethod = "cash";
  let refundedTo: Record<string, unknown> = { type: "cash", label: "Cash drawer (receipt not found)" };

  await pgClient.begin(async (sqlTx) => {
    // ── Restore stock ──
    if (rr.bundleId !== null && bundleItemRows.length > 0) {
      for (const bi of bundleItemRows) {
        const subRows = await sqlTx<Array<{ id: number; name: string; shop_id: string; stock: number; avg_cost: string; shop_type: string }>>`
          SELECT sp.id, sp.name, sp.shop_id, sp.stock, sp.avg_cost::text AS avg_cost, s.shop_type
          FROM shop_products sp JOIN shops s ON s.id = sp.shop_id
          WHERE sp.id = ${bi.product_id} FOR UPDATE OF sp
        `;
        const sub = subRows[0];
        if (!sub) continue;
        const restoreQty = bi.quantity * rr.returnQuantity;
        const stockBefore = sub.stock;
        const stockAfter = stockBefore + restoreQty;
        await sqlTx`UPDATE shop_products SET stock = ${stockAfter}, updated_at = NOW() WHERE id = ${sub.id}`;
        if (sub.shop_type === "fifo") {
          await fifoRefundLot(sqlTx, sub.id, sub.shop_id, restoreQty, "RTN-" + rr.receiptId, pgNumber(sub.avg_cost) ?? 0);
        }
        await sqlTx`
          INSERT INTO shop_movements
            (date, product_id, product_name, shop_id, type, quantity, stock_before, stock_after,
             cost_per_unit, reference, note, created_by)
          VALUES (${today}, ${sub.id}, ${sub.name}, ${sub.shop_id}, 'void',
                  ${restoreQty}, ${stockBefore}, ${stockAfter},
                  ${pgNumber(rr.price) ?? 0}, ${"RTN-" + rr.receiptId}, ${rr.reason}, ${args.userId})
        `;
      }
    } else if (normalProductId !== null) {
      const subRows = await sqlTx<Array<{ id: number; name: string; shop_id: string; stock: number; avg_cost: string; shop_type: string }>>`
        SELECT sp.id, sp.name, sp.shop_id, sp.stock, sp.avg_cost::text AS avg_cost, s.shop_type
        FROM shop_products sp JOIN shops s ON s.id = sp.shop_id
        WHERE sp.id = ${normalProductId} FOR UPDATE OF sp
      `;
      const sub = subRows[0];
      if (sub) {
        const restoreQty = rr.returnQuantity;
        const stockBefore = sub.stock;
        const stockAfter = stockBefore + restoreQty;
        await sqlTx`UPDATE shop_products SET stock = ${stockAfter}, updated_at = NOW() WHERE id = ${sub.id}`;
        if (sub.shop_type === "fifo") {
          await fifoRefundLot(sqlTx, sub.id, sub.shop_id, restoreQty, "RTN-" + rr.receiptId, pgNumber(sub.avg_cost) ?? 0);
        }
        await sqlTx`
          INSERT INTO shop_movements
            (date, product_id, product_name, shop_id, type, quantity, stock_before, stock_after,
             cost_per_unit, reference, note, created_by)
          VALUES (${today}, ${sub.id}, ${sub.name}, ${sub.shop_id}, 'void',
                  ${restoreQty}, ${stockBefore}, ${stockAfter},
                  ${pgNumber(rr.price) ?? 0}, ${"RTN-" + rr.receiptId}, ${rr.reason}, ${args.userId})
        `;
      }
    }

    // ── Derive refund destination ──
    if (receipt) {
      const pm = receipt.paymentMethod;
      if (PAYMENT_METHOD_WALLET.has(pm)) {
        let walletId: number | null = null;
        let targetType = "";
        let targetLabel = "";
        if (receipt.customerId !== null) {
          const wRows = await sqlTx<Array<{ id: number; balance: string }>>`
            SELECT id, balance FROM wallets WHERE customer_id = ${receipt.customerId} FOR UPDATE
          `;
          if (wRows[0]) {
            walletId = wRows[0].id;
            targetType = "customer_wallet";
            targetLabel = `Customer wallet #${receipt.customerId}`;
          }
        } else if (receipt.payerUserId !== null) {
          const wRows = await sqlTx<Array<{ id: number; balance: string }>>`
            SELECT id, balance FROM wallets WHERE user_id = ${receipt.payerUserId} FOR UPDATE
          `;
          if (wRows[0]) {
            walletId = wRows[0].id;
            targetType = "user_wallet";
            targetLabel = `User wallet #${receipt.payerUserId}`;
          }
        } else if (receipt.payerDepartmentId !== null) {
          const wRows = await sqlTx<Array<{ id: number; balance: string }>>`
            SELECT id, balance FROM wallets WHERE department_id = ${receipt.payerDepartmentId} FOR UPDATE
          `;
          if (wRows[0]) {
            walletId = wRows[0].id;
            targetType = "department_wallet";
            targetLabel = `Department wallet #${receipt.payerDepartmentId}`;
          }
        }
        if (walletId !== null) {
          const bRows = await sqlTx<Array<{ balance: string }>>`SELECT balance FROM wallets WHERE id = ${walletId}`;
          const balanceBefore = Number(bRows[0].balance);
          const balanceAfter = balanceBefore + refundAmount;
          await sqlTx`UPDATE wallets SET balance = ${balanceAfter}, updated_at = NOW() WHERE id = ${walletId}`;
          await sqlTx`
            INSERT INTO wallet_transactions
              (wallet_id, transaction_type, amount, balance_before, balance_after,
               reference_type, reference_id, description, created_by)
            VALUES (${walletId}, 'REFUND', ${refundAmount}, ${balanceBefore}, ${balanceAfter},
                    'return_request', ${rr.id},
                    ${`Refund for return ${rr.id} (receipt ${rr.receiptId})`}, ${args.userId})
          `;
          derivedMethod = targetType;
          refundedTo = {
            type: targetType,
            label: targetLabel,
            walletId,
            balanceBefore,
            balanceAfter,
          };
        } else {
          derivedMethod = "cash";
          refundedTo = { type: "cash", label: `Cash drawer (wallet for ${pm} payer not found)` };
        }
      } else if (PAYMENT_METHOD_CARD.has(pm)) {
        derivedMethod = "edc_card";
        refundedTo = {
          type: "edc_card",
          label: "EDC card refund",
          maskedCard: receipt.edcMaskedCard ?? "",
          edcTerminalRef: receipt.edcTerminalRef ?? "",
          edcApprovalCode: receipt.edcApprovalCode ?? "",
        };
      } else {
        const method = pm ? pm.toLowerCase() : "cash";
        derivedMethod = method;
        const titleCased = method.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        refundedTo = { type: method, label: `${titleCased} refund` };
      }
    }

    // ── Update return request ──
    await sqlTx`
      UPDATE return_requests
      SET status = 'approved',
          refund_method = ${derivedMethod},
          refund_amount = ${refundAmount},
          processed_at = NOW()
      WHERE id = ${rr.id}
    `;
  });

  // Re-fetch processed_at for the response
  const fresh = await db.select({ processedAt: returnRequests.processedAt }).from(returnRequests).where(eq(returnRequests.id, rr.id)).limit(1);

  return {
    id: `RF-${String(rr.id).padStart(3, "0")}`,
    refundAmount,
    refundMethod: derivedMethod,
    refundedTo,
    status: "completed",
    timestamp: fresh[0]?.processedAt ?? new Date().toISOString(),
  };
}

export async function processExchange(args: {
  returnId: number;
  exchangeItems: ExchangeItemInput[];
  reason: string;
  notes?: string | null;
  userId: number;
}): Promise<ExchangeResultDTO> {
  const rrRows = await db.select().from(returnRequests).where(eq(returnRequests.id, args.returnId)).limit(1);
  if (!rrRows[0]) {
    const err = new Error(`Return request ${args.returnId} not found`);
    (err as { status?: number }).status = 404;
    throw err;
  }
  const rr = rrRows[0];
  const returnValue = (pgNumber(rr.price) ?? 0) * rr.returnQuantity;
  const today = new Date().toISOString().slice(0, 10);

  // Pre-load bundle items if bundle return
  let bundleItemRows: Array<{ product_id: number; quantity: number }> = [];
  if (rr.bundleId !== null) {
    const rows = await db
      .select({ product_id: sql<number>`product_id`, quantity: sql<number>`quantity` })
      .from(sql`bundle_items`)
      .where(sql`bundle_id = ${rr.bundleId}`);
    bundleItemRows = rows as Array<{ product_id: number; quantity: number }>;
  }
  let normalProductId: number | null = null;
  if (rr.bundleId === null) {
    const pr = await db.select({ id: shopProducts.id }).from(shopProducts).where(eq(shopProducts.productCode, rr.productCode ?? "")).limit(1);
    if (pr[0]) normalProductId = pr[0].id;
  }

  let exchangeValue = 0;
  const exchangeCodes: string[] = [];

  await pgClient.begin(async (sqlTx) => {
    // Restore returned stock
    if (rr.bundleId !== null && bundleItemRows.length > 0) {
      for (const bi of bundleItemRows) {
        const subRows = await sqlTx<Array<{ id: number; name: string; shop_id: string; stock: number; avg_cost: string; shop_type: string }>>`
          SELECT sp.id, sp.name, sp.shop_id, sp.stock, sp.avg_cost::text AS avg_cost, s.shop_type
          FROM shop_products sp JOIN shops s ON s.id = sp.shop_id
          WHERE sp.id = ${bi.product_id} FOR UPDATE OF sp
        `;
        const sub = subRows[0];
        if (!sub) continue;
        const restoreQty = bi.quantity * rr.returnQuantity;
        const stockBefore = sub.stock;
        const stockAfter = stockBefore + restoreQty;
        await sqlTx`UPDATE shop_products SET stock = ${stockAfter}, updated_at = NOW() WHERE id = ${sub.id}`;
        if (sub.shop_type === "fifo") {
          await fifoRefundLot(sqlTx, sub.id, sub.shop_id, restoreQty, "RTN-" + rr.receiptId, pgNumber(sub.avg_cost) ?? 0);
        }
        await sqlTx`
          INSERT INTO shop_movements
            (date, product_id, product_name, shop_id, type, quantity, stock_before, stock_after,
             cost_per_unit, reference, note, created_by)
          VALUES (${today}, ${sub.id}, ${sub.name}, ${sub.shop_id}, 'void',
                  ${restoreQty}, ${stockBefore}, ${stockAfter},
                  ${pgNumber(rr.price) ?? 0}, ${"RTN-" + rr.receiptId}, ${rr.reason}, ${args.userId})
        `;
      }
    } else if (normalProductId !== null) {
      const subRows = await sqlTx<Array<{ id: number; name: string; shop_id: string; stock: number; avg_cost: string; shop_type: string }>>`
        SELECT sp.id, sp.name, sp.shop_id, sp.stock, sp.avg_cost::text AS avg_cost, s.shop_type
        FROM shop_products sp JOIN shops s ON s.id = sp.shop_id
        WHERE sp.id = ${normalProductId} FOR UPDATE OF sp
      `;
      const sub = subRows[0];
      if (sub) {
        const restoreQty = rr.returnQuantity;
        const stockBefore = sub.stock;
        const stockAfter = stockBefore + restoreQty;
        await sqlTx`UPDATE shop_products SET stock = ${stockAfter}, updated_at = NOW() WHERE id = ${sub.id}`;
        if (sub.shop_type === "fifo") {
          await fifoRefundLot(sqlTx, sub.id, sub.shop_id, restoreQty, "RTN-" + rr.receiptId, pgNumber(sub.avg_cost) ?? 0);
        }
        await sqlTx`
          INSERT INTO shop_movements
            (date, product_id, product_name, shop_id, type, quantity, stock_before, stock_after,
             cost_per_unit, reference, note, created_by)
          VALUES (${today}, ${sub.id}, ${sub.name}, ${sub.shop_id}, 'void',
                  ${restoreQty}, ${stockBefore}, ${stockAfter},
                  ${pgNumber(rr.price) ?? 0}, ${"RTN-" + rr.receiptId}, ${rr.reason}, ${args.userId})
        `;
      }
    }

    // Deduct exchanged items
    for (const ex of args.exchangeItems) {
      const prRows = await sqlTx<Array<{ id: number; name: string; shop_id: string; stock: number; external_price: string; avg_cost: string; shop_type: string }>>`
        SELECT sp.id, sp.name, sp.shop_id, sp.stock, sp.external_price, sp.avg_cost::text AS avg_cost, s.shop_type
        FROM shop_products sp JOIN shops s ON s.id = sp.shop_id
        WHERE sp.product_code = ${ex.productCode} FOR UPDATE OF sp
      `;
      const product = prRows[0];
      if (!product) continue;
      const stockBefore = product.stock;
      exchangeValue += (pgNumber(product.external_price) ?? 0) * ex.quantity;
      exchangeCodes.push(ex.productCode);
      let stockAfter: number;
      let newAvgCost = pgNumber(product.avg_cost) ?? 0;
      if (product.shop_type === "fifo") {
        const r = await fifoDeductInTx(sqlTx, product.id, ex.quantity, product.shop_id);
        stockAfter = r.newStock;
        newAvgCost = r.newAvgCost;
        await sqlTx`UPDATE shop_products SET stock = ${r.newStock}, avg_cost = ${r.newAvgCost}, updated_at = NOW() WHERE id = ${product.id}`;
      } else {
        stockAfter = stockBefore - ex.quantity;
        await sqlTx`UPDATE shop_products SET stock = ${stockAfter}, updated_at = NOW() WHERE id = ${product.id}`;
      }
      await sqlTx`
        INSERT INTO shop_movements
          (date, product_id, product_name, shop_id, type, quantity, stock_before, stock_after,
           cost_per_unit, reference, note, created_by)
        VALUES (${today}, ${product.id}, ${product.name}, ${product.shop_id}, 'exchange',
                ${-ex.quantity}, ${stockBefore}, ${stockAfter},
                ${newAvgCost}, ${"EX-" + String(rr.id).padStart(3, "0")},
                ${"Exchange from return " + rr.receiptId}, ${args.userId})
      `;
    }

    await sqlTx`
      UPDATE return_requests
      SET status = 'approved',
          exchange_product_codes = ${exchangeCodes.join(",")},
          exchange_amount = ${exchangeValue},
          refund_amount = ${returnValue},
          processed_at = NOW()
      WHERE id = ${rr.id}
    `;
  });

  const fresh = await db.select({ processedAt: returnRequests.processedAt }).from(returnRequests).where(eq(returnRequests.id, rr.id)).limit(1);

  return {
    id: `EX-${String(rr.id).padStart(3, "0")}`,
    returnValue,
    exchangeValue,
    difference: exchangeValue - returnValue,
    status: "completed",
    timestamp: fresh[0]?.processedAt ?? new Date().toISOString(),
  };
}

function toHistoryDto(rr: typeof returnRequests.$inferSelect): ReturnHistoryDTO {
  const exchanged = rr.exchangeProductCodes
    ? rr.exchangeProductCodes.split(",").map((c) => c.trim()).filter(Boolean)
    : [];
  const computed = (pgNumber(rr.price) ?? 0) * (rr.returnQuantity ?? 0);
  const returnVal = rr.refundAmount !== null ? pgNumber(rr.refundAmount) ?? computed : computed;
  const exchangeVal = pgNumber(rr.exchangeAmount) ?? 0;
  const ts = rr.processedAt ?? rr.createdAt;
  return {
    id: `RT-${String(rr.id).padStart(3, "0")}`,
    date: ts ? ts.slice(0, 16).replace("T", " ") : "",
    receiptId: rr.receiptId,
    studentId: "",
    studentName: "",
    returnedItems: [`${rr.productName} x${rr.returnQuantity}`],
    exchangedItems: exchanged,
    returnValue: returnVal,
    exchangeValue: exchangeVal,
    difference: exchangeVal - returnVal,
    status: rr.status,
    reason: rr.reason,
  };
}
