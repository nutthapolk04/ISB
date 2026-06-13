import { and, desc, eq, ilike, ne, or, sql, isNull } from "drizzle-orm";
import { db, pgClient } from "@/db/client";
import { returnRequests, receipts, shopProducts } from "@/db/schema";
import { pgNumber } from "@/lib/dates";

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
