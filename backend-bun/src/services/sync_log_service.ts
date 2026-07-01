import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { syncLogs, users } from "@/db/schema";
import { pgToIso } from "@/lib/dates";

export interface SyncLogItemDTO {
    id: number;
    sync_type: string;
    target_roles: string[];
    triggered_by_name: string | null;
    started_at: string;
    finished_at: string | null;
    status: string;
    records_total: number;
    records_success: number;
    records_failed: number;
    error_log: string | null;
}

export interface DailyBucketDTO {
    date: string;
    success: number;
    failed: number;
}

export interface SyncStatsDTO {
    total_runs: number;
    total_success: number;
    total_failed: number;
    last_sync_at: string | null;
    last_sync_status: string | null;
    daily: DailyBucketDTO[];
}

export async function listSyncLogs(limit = 50, offset = 0): Promise<SyncLogItemDTO[]> {
    const rows = await db
        .select({
            id: syncLogs.id,
            syncType: syncLogs.syncType,
            targetRoles: syncLogs.targetRoles,
            triggeredBy: syncLogs.triggeredBy,
            startedAt: syncLogs.startedAt,
            finishedAt: syncLogs.finishedAt,
            status: syncLogs.status,
            recordsTotal: syncLogs.recordsTotal,
            recordsSuccess: syncLogs.recordsSuccess,
            recordsFailed: syncLogs.recordsFailed,
            errorLog: syncLogs.errorLog,
            triggeredByName: users.fullName,
        })
        .from(syncLogs)
        .leftJoin(users, eq(users.id, syncLogs.triggeredBy))
        .orderBy(desc(syncLogs.startedAt))
        .limit(limit)
        .offset(offset);

    return rows.map((r) => ({
        id: r.id,
        sync_type: r.syncType,
        target_roles: Array.isArray(r.targetRoles) ? (r.targetRoles as string[]) : [],
        triggered_by_name: r.triggeredByName ?? null,
        started_at: pgToIso(r.startedAt)!,
        finished_at: pgToIso(r.finishedAt),
        status: r.status,
        records_total: r.recordsTotal,
        records_success: r.recordsSuccess,
        records_failed: r.recordsFailed,
        error_log: r.errorLog ?? null,
    }));
}

export async function syncStats(daysBack = 30): Promise<SyncStatsDTO> {
    const since = new Date(Date.now() - daysBack * 86_400_000).toISOString();

    const totals = await db
        .select({
            total: sql<string>`COUNT(*)`,
            success: sql<string>`COALESCE(SUM(${syncLogs.recordsSuccess}), 0)`,
            failed: sql<string>`COALESCE(SUM(${syncLogs.recordsFailed}), 0)`,
        })
        .from(syncLogs)
        .where(gte(syncLogs.startedAt, since));

    const lastRows = await db
        .select({ startedAt: syncLogs.startedAt, status: syncLogs.status })
        .from(syncLogs)
        .orderBy(desc(syncLogs.startedAt))
        .limit(1);

    const dailyRows = await db
        .select({
            d: sql<string>`DATE(${syncLogs.startedAt})`,
            success: sql<string>`COALESCE(SUM(${syncLogs.recordsSuccess}), 0)`,
            failed: sql<string>`COALESCE(SUM(${syncLogs.recordsFailed}), 0)`,
        })
        .from(syncLogs)
        .where(gte(syncLogs.startedAt, since))
        .groupBy(sql`DATE(${syncLogs.startedAt})`)
        .orderBy(sql`DATE(${syncLogs.startedAt})`);

    return {
        total_runs: Number(totals[0]?.total ?? 0),
        total_success: Number(totals[0]?.success ?? 0),
        total_failed: Number(totals[0]?.failed ?? 0),
        last_sync_at: lastRows[0] ? pgToIso(lastRows[0].startedAt) : null,
        last_sync_status: lastRows[0]?.status ?? null,
        daily: dailyRows.map((r) => ({
            date: String(r.d).slice(0, 10),
            success: Number(r.success),
            failed: Number(r.failed),
        })),
    };
}
