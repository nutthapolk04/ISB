import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { returnRequests, receipts } from "@/db/schema";
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
