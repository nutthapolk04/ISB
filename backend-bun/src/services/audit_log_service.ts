import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, users } from "@/db/schema";
import { pgToIso } from "@/lib/dates";

export interface AuditLogEntryDTO {
  id: number;
  created_at: string;
  entity_type: string;
  entity_id: number | null;
  entity_name: string | null;
  shop_id: string | null;
  action: string;
  user_id: number;
  user_username: string | null;
  user_full_name: string | null;
  changes: unknown | null;
  ip_address: string | null;
}

export interface AuditLogListResponseDTO {
  items: AuditLogEntryDTO[];
  total: number;
}

export interface ListAuditLogsParams {
  entityType?: string | null;
  action?: string | null;
  userId?: number | null;
  shopId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  page?: number | null;
  pageSize?: number | null;
  callerIsAdmin: boolean;
  callerShopId?: string | null;
}

export async function listAuditLogs(p: ListAuditLogsParams): Promise<AuditLogListResponseDTO> {
  const page = Math.max(1, p.page ?? 1);
  const pageSize = Math.min(p.pageSize ?? 50, 500);
  const offset = (page - 1) * pageSize;

  // Non-admins are pinned to their own shop regardless of the query param.
  let shopId = p.shopId;
  if (!p.callerIsAdmin) {
    shopId = p.callerShopId ?? "__none__";
  }

  const conds = [];
  if (shopId) conds.push(eq(auditLogs.shopId, shopId));
  if (p.entityType) conds.push(eq(auditLogs.entityType, p.entityType));
  if (p.action) conds.push(eq(auditLogs.action, p.action as typeof auditLogs.$inferSelect.action));
  if (p.userId != null) conds.push(eq(auditLogs.userId, p.userId));
  if (p.dateFrom) conds.push(gte(auditLogs.createdAt, `${p.dateFrom}T00:00:00+07:00`));
  if (p.dateTo) conds.push(lte(auditLogs.createdAt, `${p.dateTo}T23:59:59.999999+07:00`));

  const whereExpr = conds.length > 0 ? and(...conds) : undefined;

  const totalRow = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(auditLogs)
    .where(whereExpr);
  const total = Number(totalRow[0]?.count ?? 0);

  const rows = await db
    .select({
      id: auditLogs.id,
      created_at: auditLogs.createdAt,
      entity_type: auditLogs.entityType,
      entity_id: auditLogs.entityId,
      entity_name: auditLogs.entityName,
      shop_id: auditLogs.shopId,
      action: auditLogs.action,
      changes_json: auditLogs.changesJson,
      user_id: auditLogs.userId,
      ip_address: auditLogs.ipAddress,
      user_username: users.username,
      user_full_name: users.fullName,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(whereExpr)
    .orderBy(desc(auditLogs.createdAt))
    .limit(pageSize)
    .offset(offset);

  const items: AuditLogEntryDTO[] = rows.map((r) => ({
    id: r.id,
    created_at: pgToIso(r.created_at)!,
    entity_type: r.entity_type,
    entity_id: r.entity_id ?? null,
    entity_name: r.entity_name ?? null,
    shop_id: r.shop_id ?? null,
    action: r.action,
    user_id: r.user_id,
    user_username: r.user_username ?? null,
    user_full_name: r.user_full_name ?? null,
    changes: r.changes_json ?? null,
    ip_address: r.ip_address ?? null,
  }));

  return { items, total };
}
