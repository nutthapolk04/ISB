/**
 * Staleness-based department deactivation — same reasoning as
 * family_sweep_service.ts, applied to the department sync channel.
 *
 * ISB's vendor sync sends the FULL current active dataset every cycle
 * (confirmed 2026-07: hourly, chunked into several batches, not a delta
 * feed) with no "last batch of the run" signal. So a department_code
 * missing from any single processDepartmentBatch() call can't safely be
 * treated as "ISB stopped reporting it" — use `departments.lastSyncedAt`
 * staleness instead (touched ONLY by the sync path, never by admin's own
 * updateDepartment(), so a manual admin edit is never mistaken for sync
 * activity or vice versa).
 *
 * Deactivates (`is_active = false`) any department whose lastSyncedAt is
 * older than cutoffHours. Reactivates automatically the next time ISB
 * reports it again (processDepartmentBatch sets is_active=true on every
 * touch — see isb_sync_service.ts). Note: that reactivation is unconditional,
 * so if an admin manually deactivated a department for their own reasons
 * (not because ISB stopped reporting it), the NEXT sync touch will flip it
 * back to active — flagged for the school to confirm this is the wanted
 * behavior, since it means ISB sync always wins over a manual admin toggle.
 *
 * Same safety gate as the family sweep: refuses to run if nothing has been
 * synced recently at all, rather than risk mass-deactivating every
 * department because the pipeline itself is paused/down.
 */
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { departments } from "@/db/schema";
import { logger } from "@/logger";

export interface DepartmentSweepResult {
    departmentsSwept: number;
    departmentCodesSwept: string[];
    skippedNoRecentActivity?: boolean;
}

// See family_sweep_service.ts's RECENT_ACTIVITY_WINDOW_HOURS for the same
// reasoning, sized off ISB's confirmed hourly cadence.
const RECENT_ACTIVITY_WINDOW_HOURS = 2;

export async function sweepStaleDepartments(cutoffHours: number): Promise<DepartmentSweepResult> {
    const cutoff = new Date(Date.now() - cutoffHours * 60 * 60 * 1000).toISOString();

    const recentActivityCutoff = new Date(Date.now() - RECENT_ACTIVITY_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const recentlyActive = await db
        .select({ id: departments.id })
        .from(departments)
        .where(gte(departments.lastSyncedAt, recentActivityCutoff))
        .limit(1);
    if (recentlyActive.length === 0) {
        logger.warn(
            `[department sweep] skipped — no department touched in the last ${RECENT_ACTIVITY_WINDOW_HOURS}h; ` +
            "ISB's sync pipeline may be paused/down. Refusing to sweep blind rather than risk mass-deactivating every department.",
        );
        return { departmentsSwept: 0, departmentCodesSwept: [], skippedNoRecentActivity: true };
    }

    const staleDepartments = await db
        .select({ id: departments.id, code: departments.departmentCode })
        .from(departments)
        .where(and(eq(departments.isActive, true), lt(departments.lastSyncedAt, cutoff)));

    if (staleDepartments.length > 0) {
        await db.update(departments).set({ isActive: false }).where(
            inArray(departments.id, staleDepartments.map((d) => d.id)),
        );
        logger.info(
            `[department sweep] ${staleDepartments.length} department(s) stale (>${cutoffHours}h) — deactivated`,
            { departmentCodes: staleDepartments.map((d) => d.code) },
        );
    }

    return {
        departmentsSwept: staleDepartments.length,
        departmentCodesSwept: staleDepartments.map((d) => d.code),
    };
}
