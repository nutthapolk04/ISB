import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import { users, customers, departments, wallets, syncLogs, syncAuditLogs } from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";

export type CardholderKind = "student" | "parent" | "staff" | "department" | "other";

export interface CardholderDTO {
  key: string;
  kind: CardholderKind;
  entity_type: "user" | "customer" | "department";
  entity_id: number;
  name: string;
  identifier: string;
  photo_url: string | null;
  family_code: string | null;
  external_id: string | null;
  card_uid: string | null;
  wallet_id: number | null;
  wallet_balance: number | null;
  is_active: boolean;
  is_graduated: boolean;
  role: string | null;
  shop_id: string | null;
  grade: string | null;
  school_type: string | null;
  allergies: string | null;
  department_code: string | null;
  synced_at: string | null;
}

export interface CardholderListResponseDTO {
  items: CardholderDTO[];
  total: number;
}

const STAFF_ROLES = new Set(["cashier", "manager", "kitchen", "staff"]);

function blank(): Omit<CardholderDTO, "key" | "kind" | "entity_type" | "entity_id" | "name" | "identifier"> {
  return {
    photo_url: null,
    family_code: null,
    external_id: null,
    card_uid: null,
    wallet_id: null,
    wallet_balance: null,
    is_active: true,
    is_graduated: false,
    role: null,
    shop_id: null,
    grade: null,
    school_type: null,
    allergies: null,
    department_code: null,
    synced_at: null,
  };
}

export async function listCardholders(args: {
  kind?: string | null;
  q?: string | null;
  page: number;
  pageSize: number;
}): Promise<CardholderListResponseDTO> {
  const pattern = args.q && args.q.trim() ? `%${args.q.trim()}%` : null;
  const kindFilter = args.kind && args.kind !== "all" ? args.kind : null;

  const rows: CardholderDTO[] = [];

  // ── Users (parent + staff) ──
  if (kindFilter === null || kindFilter === "parent" || kindFilter === "staff") {
    let roleSet: string[];
    if (kindFilter === "parent") roleSet = ["parent"];
    else if (kindFilter === "staff") roleSet = [...STAFF_ROLES, "admin"];
    else roleSet = [...STAFF_ROLES, "parent", "admin"];

    const where = [inArray(users.role, roleSet)];
    if (pattern) {
      where.push(
        or(
          ilike(users.username, pattern),
          ilike(users.fullName, pattern),
          ilike(users.email, pattern),
          ilike(users.externalId, pattern),
          ilike(users.familyCode, pattern),
        )!,
      );
    }
    const uRows = await db.select().from(users).where(and(...where));
    const userIds = uRows.map((u) => u.id);
    const userWallets = userIds.length > 0
      ? await db.select().from(wallets).where(inArray(wallets.userId, userIds))
      : [];
    const walletByUser = new Map<number, typeof wallets.$inferSelect>();
    for (const w of userWallets) if (w.userId !== null) walletByUser.set(w.userId, w);
    for (const u of uRows) {
      const w = walletByUser.get(u.id) ?? null;
      const role = u.role ?? "";
      const kind: CardholderKind = role === "parent" ? "parent" : "staff";
      rows.push({
        ...blank(),
        key: `u-${u.id}`,
        kind,
        entity_type: "user",
        entity_id: u.id,
        name: u.fullName,
        identifier: u.username,
        photo_url: u.photoUrl ?? null,
        family_code: u.familyCode ?? null,
        external_id: u.externalId ?? null,
        card_uid: u.cardUid ?? null,
        wallet_id: w?.id ?? null,
        wallet_balance: w ? pgNumber(w.balance) : null,
        is_active: u.isActive,
        role: role || null,
        shop_id: u.shopId ?? null,
        synced_at: u.lastSyncedAt ? pgToIso(u.lastSyncedAt) : null,
      });
    }
  }

  // ── Customers (student + other) ──
  if (kindFilter === null || kindFilter === "student" || kindFilter === "other") {
    const where = [inArray(customers.customerKind, kindFilter ? [kindFilter] : ["student", "other"])];
    if (pattern) {
      where.push(
        or(
          ilike(customers.name, pattern),
          ilike(customers.customerCode, pattern),
          ilike(customers.studentCode, pattern),
          ilike(customers.externalId, pattern),
          ilike(customers.familyCode, pattern),
        )!,
      );
    }
    const cRows = await db.select().from(customers).where(and(...where));
    const customerIds = cRows.map((c) => c.id);
    const custWallets = customerIds.length > 0
      ? await db.select().from(wallets).where(inArray(wallets.customerId, customerIds))
      : [];
    const walletByCust = new Map<number, typeof wallets.$inferSelect>();
    for (const w of custWallets) if (w.customerId !== null) walletByCust.set(w.customerId, w);
    for (const c of cRows) {
      const w = walletByCust.get(c.id) ?? null;
      const rawKind = (c.customerKind ?? "other").toLowerCase();
      const kind: CardholderKind = (rawKind === "student" || rawKind === "department" || rawKind === "other")
        ? (rawKind as CardholderKind) : "other";
      rows.push({
        ...blank(),
        key: `c-${c.id}`,
        kind,
        entity_type: "customer",
        entity_id: c.id,
        name: c.name,
        identifier: c.studentCode ?? c.customerCode,
        photo_url: c.photoUrl ?? null,
        family_code: c.familyCode ?? null,
        external_id: c.externalId ?? null,
        card_uid: c.cardUid ?? null,
        wallet_id: w?.id ?? null,
        wallet_balance: w ? pgNumber(w.balance) : null,
        is_active: c.isActive,
        is_graduated: !!(c as { isGraduated?: boolean }).isGraduated,
        grade: c.grade ?? null,
        school_type: c.schoolType ?? null,
        allergies: c.allergies ?? null,
        synced_at: c.powerschoolSyncAt ? pgToIso(c.powerschoolSyncAt) : null,
      });
    }
  }

  // ── Departments ──
  if (kindFilter === null || kindFilter === "department") {
    const where = [];
    if (pattern) {
      where.push(
        or(
          ilike(departments.departmentCode, pattern),
          ilike(departments.departmentName, pattern),
        )!,
      );
    }
    const dRows = where.length > 0
      ? await db.select().from(departments).where(and(...where))
      : await db.select().from(departments);
    const deptIds = dRows.map((d) => d.id);
    const deptWallets = deptIds.length > 0
      ? await db.select().from(wallets).where(inArray(wallets.departmentId, deptIds))
      : [];
    const walletByDept = new Map<number, typeof wallets.$inferSelect>();
    for (const w of deptWallets) if (w.departmentId !== null) walletByDept.set(w.departmentId, w);
    for (const d of dRows) {
      const w = walletByDept.get(d.id) ?? null;
      rows.push({
        ...blank(),
        key: `d-${d.id}`,
        kind: "department",
        entity_type: "department",
        entity_id: d.id,
        name: d.departmentName,
        identifier: d.departmentCode,
        wallet_id: w?.id ?? null,
        wallet_balance: w ? pgNumber(w.balance) : null,
        is_active: d.isActive,
        department_code: d.departmentCode,
      });
    }
  }

  rows.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  const total = rows.length;
  const start = (args.page - 1) * args.pageSize;
  return { items: rows.slice(start, start + args.pageSize), total };
}

// ── Sync log + audit reads (mirrors admin_cardholders.py sync-log endpoints) ──

export interface SyncStatusDTO {
  sync_log_id: number;
  sync_type: string;
  status: string;
  target_roles: string[];
  started_at: string;
  finished_at: string | null;
  records_total: number;
  records_success: number;
  records_failed: number;
  error_log: string | null;
}

function toSyncStatus(r: typeof syncLogs.$inferSelect): SyncStatusDTO {
  return {
    sync_log_id: r.id,
    sync_type: r.syncType,
    status: r.status,
    target_roles: Array.isArray(r.targetRoles) ? (r.targetRoles as string[]) : [],
    started_at: pgToIso(r.startedAt)!,
    finished_at: r.finishedAt ? pgToIso(r.finishedAt) : null,
    records_total: r.recordsTotal,
    records_success: r.recordsSuccess,
    records_failed: r.recordsFailed,
    error_log: r.errorLog ?? null,
  };
}

export async function getSyncLog(syncLogId: number): Promise<SyncStatusDTO> {
  const rows = await db.select().from(syncLogs).where(eq(syncLogs.id, syncLogId)).limit(1);
  if (!rows[0]) {
    const err = new Error("Sync log not found");
    (err as { status?: number }).status = 404;
    throw err;
  }
  return toSyncStatus(rows[0]);
}

export async function listSyncStatuses(limit: number): Promise<SyncStatusDTO[]> {
  const rows = await db.select().from(syncLogs).orderBy(desc(syncLogs.startedAt)).limit(limit);
  return rows.map(toSyncStatus);
}

export interface SyncAuditEntryDTO {
  id: number;
  sync_log_id: number;
  entity_type: string;
  entity_id: number;
  entity_name: string | null;
  external_id: string | null;
  action: string;
  changes: unknown;
  created_at: string;
}

export async function listSyncAudit(syncLogId: number, action: string | null): Promise<SyncAuditEntryDTO[]> {
  const where = [eq(syncAuditLogs.syncLogId, syncLogId)];
  if (action) where.push(eq(syncAuditLogs.action, action));
  const rows = await db.select().from(syncAuditLogs).where(and(...where)).orderBy(asc(syncAuditLogs.id));
  return rows.map((r) => ({
    id: r.id,
    sync_log_id: r.syncLogId,
    entity_type: r.entityType,
    entity_id: r.entityId,
    entity_name: r.entityName ?? null,
    external_id: r.externalId ?? null,
    action: r.action,
    changes: r.changes ?? null,
    created_at: pgToIso(r.createdAt)!,
  }));
}
