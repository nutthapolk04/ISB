/**
 * Admin reports — mirrors /admin/adjustment-report + /admin/transfer-report
 * in FastAPI app/api/v1/wallets.py.
 */
import { and, desc, eq, gte, isNull, like, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { walletTransactions, wallets, customers, users, departments } from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";

export interface AdjustmentReportRow {
  id: number;
  created_at: string;
  entity_type: string;
  entity_name: string;
  entity_code: string;
  direction: "credit" | "debit";
  amount: number;
  balance_before: number;
  balance_after: number;
  reason: string | null;
  reference_ticket: string | null;
  adjusted_by: string;
}

function parseAdjDescription(desc: string | null): { reason: string; ticket: string | null } {
  if (!desc) return { reason: "", ticket: null };
  let ticket: string | null = null;
  const m = /\[ref:([^\]]+)\]/.exec(desc);
  if (m) ticket = m[1].trim();
  let idx = desc.indexOf(" — ");
  if (idx === -1) idx = desc.indexOf(" - ");
  const reason = idx === -1 ? desc : desc.slice(idx + 3).trim();
  return { reason, ticket };
}

export async function adjustmentReport(args: {
  dateFrom?: string | null;
  dateTo?: string | null;
  direction?: string | null;
  typeFilter?: string | null;
}): Promise<AdjustmentReportRow[]> {
  const conds = [eq(walletTransactions.transactionType, "ADJUSTMENT"), isNull(wallets.departmentId)];
  if (args.dateFrom) {
    try { conds.push(gte(walletTransactions.createdAt, args.dateFrom)); }
    catch { /* ignore */ }
  }
  if (args.dateTo) {
    try {
      const end = new Date(`${args.dateTo}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      conds.push(lt(walletTransactions.createdAt, end.toISOString()));
    } catch { /* ignore */ }
  }

  const rows = await db
    .select({
      tx: walletTransactions,
      w: wallets,
    })
    .from(walletTransactions)
    .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
    .where(and(...conds))
    .orderBy(desc(walletTransactions.createdAt));

  const out: AdjustmentReportRow[] = [];
  for (const r of rows) {
    const tx = r.tx;
    const w = r.w;
    const before = pgNumber(tx.balanceBefore) ?? 0;
    const after = pgNumber(tx.balanceAfter) ?? 0;
    const delta = after - before;
    const dir: "credit" | "debit" = delta >= 0 ? "credit" : "debit";
    if (args.direction === "credit" || args.direction === "debit") {
      if (dir !== args.direction) continue;
    }

    let entityType = "unknown", entityName = "—", entityCode = "—";
    if (w.customerId !== null) {
      const cr = await db.select().from(customers).where(eq(customers.id, w.customerId)).limit(1);
      if (cr[0]) { entityType = "student"; entityName = cr[0].name; entityCode = cr[0].studentCode ?? cr[0].customerCode; }
    } else if (w.userId !== null) {
      const ur = await db.select().from(users).where(eq(users.id, w.userId)).limit(1);
      if (ur[0]) { entityType = ur[0].role ?? "staff"; entityName = ur[0].fullName || ur[0].username; entityCode = ur[0].username; }
    } else if (w.departmentId !== null) {
      const dr = await db.select().from(departments).where(eq(departments.id, w.departmentId)).limit(1);
      if (dr[0]) { entityType = "department"; entityName = dr[0].departmentName; entityCode = dr[0].departmentCode; }
    }

    let creatorName = String(tx.createdBy);
    const cr = await db.select({ fullName: users.fullName, username: users.username }).from(users).where(eq(users.id, tx.createdBy)).limit(1);
    if (cr[0]) creatorName = cr[0].fullName || cr[0].username;

    let reason: string | null = tx.reason ?? null;
    let refTicket: string | null = tx.referenceTicket ?? null;
    if (!reason) {
      const parsed = parseAdjDescription(tx.description);
      reason = parsed.reason || null;
      if (!refTicket) refTicket = parsed.ticket;
    }

    if (args.typeFilter) {
      const wanted = args.typeFilter.trim().toLowerCase();
      const bucket = entityType === "student" ? "student"
        : entityType === "department" ? "department"
        : entityType === "unknown" ? "other"
        : "staff";
      if (wanted !== bucket) continue;
    }

    out.push({
      id: tx.id,
      created_at: pgToIso(tx.createdAt)!,
      entity_type: entityType,
      entity_name: entityName,
      entity_code: entityCode,
      direction: dir,
      amount: pgNumber(tx.amount) ?? 0,
      balance_before: before,
      balance_after: after,
      reason,
      reference_ticket: refTicket,
      adjusted_by: creatorName,
    });
  }
  return out;
}

// ── Transfer report ────────────────────────────────────────────────────────

export interface TransferReportRow {
  id: number;
  created_at: string;
  from_name: string;
  from_code: string;
  to_name: string;
  to_code: string;
  amount: number;
  note: string | null;
  transferred_by: string;
}

export interface TransferReportResponseDTO {
  items: TransferReportRow[];
  total: number;
  page: number;
  pages: number;
}

async function resolveWalletNameCode(walletId: number | null): Promise<{ name: string; code: string }> {
  if (!walletId) return { name: "—", code: "—" };
  const wRows = await db.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
  const w = wRows[0];
  if (!w) return { name: "—", code: "—" };
  if (w.customerId !== null) {
    const cr = await db.select().from(customers).where(eq(customers.id, w.customerId)).limit(1);
    if (cr[0]) return { name: cr[0].name, code: cr[0].studentCode ?? cr[0].customerCode };
  }
  if (w.userId !== null) {
    const ur = await db.select().from(users).where(eq(users.id, w.userId)).limit(1);
    if (ur[0]) return { name: ur[0].fullName || ur[0].username, code: ur[0].username };
  }
  if (w.departmentId !== null) {
    const dr = await db.select().from(departments).where(eq(departments.id, w.departmentId)).limit(1);
    if (dr[0]) return { name: dr[0].departmentName, code: dr[0].departmentCode };
  }
  return { name: "—", code: "—" };
}

export async function transferReport(args: {
  dateFrom?: string | null;
  dateTo?: string | null;
  page: number;
  pageSize: number;
}): Promise<TransferReportResponseDTO> {
  const conds = [
    eq(walletTransactions.referenceType, "family_transfer"),
    like(walletTransactions.description, "Family transfer →%"),
  ];
  if (args.dateFrom) conds.push(gte(walletTransactions.createdAt, args.dateFrom));
  if (args.dateTo) {
    const end = new Date(`${args.dateTo}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    conds.push(lt(walletTransactions.createdAt, end.toISOString()));
  }
  // total
  const totalRows = await db.select({ id: walletTransactions.id }).from(walletTransactions).where(and(...conds));
  const total = totalRows.length;

  const rows = await db
    .select()
    .from(walletTransactions)
    .where(and(...conds))
    .orderBy(desc(walletTransactions.createdAt))
    .offset((args.page - 1) * args.pageSize)
    .limit(args.pageSize);

  const items: TransferReportRow[] = [];
  for (const tx of rows) {
    const from = await resolveWalletNameCode(tx.walletId);
    const to = await resolveWalletNameCode(tx.referenceId);
    let note: string | null = null;
    if (tx.description && tx.description.includes(" — ")) {
      const parts = tx.description.split(" — ");
      note = parts[1]?.trim() || null;
    }
    let by = "—";
    if (tx.createdBy) {
      const ur = await db.select({ fullName: users.fullName, username: users.username }).from(users).where(eq(users.id, tx.createdBy)).limit(1);
      if (ur[0]) by = ur[0].fullName || ur[0].username;
    }
    items.push({
      id: tx.id,
      created_at: pgToIso(tx.createdAt)!,
      from_name: from.name,
      from_code: from.code,
      to_name: to.name,
      to_code: to.code,
      amount: pgNumber(tx.amount) ?? 0,
      note,
      transferred_by: by,
    });
  }

  return {
    items,
    total,
    page: args.page,
    pages: Math.max(1, Math.ceil(total / args.pageSize)),
  };
}
