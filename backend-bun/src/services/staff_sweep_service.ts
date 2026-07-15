/**
 * Staleness-based staff deactivation.
 *
 * Same "batch is a full active-state snapshot, no last-batch signal"
 * reasoning as family_sweep_service.ts / department_sweep_service.ts,
 * applied to staff — per 2026-07 review: a person absent from ISB's staff
 * data means they are no longer staff, full stop.
 *
 * Unlike the family sweep, this deliberately reuses the SHARED
 * `users.lastSyncedAt` column rather than a dedicated one. A staff person
 * can be confirmed alive by either of two independent channels — the plain
 * /sync/staffs batch (upsertStaff) OR being listed as a family's Staff-type
 * parent in /sync/families (upsertStaffParentRef) — and `lastSyncedAt` is
 * touched by both. That's exactly the semantic wanted here: "has EITHER
 * channel reconfirmed this person recently" — whichever touched them most
 * recently is enough proof they're still valid, so there's no need (or
 * benefit) to tell the two touches apart the way family_profiles.lastSyncedAt
 * deliberately does NOT get touched by the staff channel.
 *
 * Deactivates (is_active=false) AND clears family_code (if any — e.g. a
 * Staff person who was also a family's secondaryParent) once neither
 * channel has confirmed them in cutoffHours. Reactivates automatically the
 * next time either channel touches them again — both upsertStaff and
 * upsertStaffParentRef's update paths set isActive=true on every touch.
 *
 * Same safety gate: refuses to run if no staff row has been touched
 * recently at all, rather than risk deactivating every employee's login
 * because the pipeline itself is paused/down.
 */
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { parentChildLinks, users } from "@/db/schema";
import { logger } from "@/logger";

export interface StaffSweepResult {
    staffSwept: number;
    externalIdsSwept: string[];
    skippedNoRecentActivity?: boolean;
}

// See family_sweep_service.ts's RECENT_ACTIVITY_WINDOW_HOURS for the same
// reasoning, sized off ISB's confirmed hourly cadence.
const RECENT_ACTIVITY_WINDOW_HOURS = 2;

export async function sweepStaleStaff(cutoffHours: number): Promise<StaffSweepResult> {
    const cutoff = new Date(Date.now() - cutoffHours * 60 * 60 * 1000).toISOString();

    const recentActivityCutoff = new Date(Date.now() - RECENT_ACTIVITY_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const recentlyActive = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, "staff"), gte(users.lastSyncedAt, recentActivityCutoff)))
        .limit(1);
    if (recentlyActive.length === 0) {
        logger.warn(
            `[staff sweep] skipped — no staff row touched in the last ${RECENT_ACTIVITY_WINDOW_HOURS}h; ` +
            "ISB's sync pipeline may be paused/down. Refusing to sweep blind rather than risk deactivating every staff account.",
        );
        return { staffSwept: 0, externalIdsSwept: [], skippedNoRecentActivity: true };
    }

    const staleStaff = await db
        .select({ id: users.id, externalId: users.externalId })
        .from(users)
        .where(and(eq(users.role, "staff"), eq(users.isActive, true), lt(users.lastSyncedAt, cutoff)));

    if (staleStaff.length > 0) {
        const staleIds = staleStaff.map((s) => s.id);
        await db.delete(parentChildLinks).where(inArray(parentChildLinks.parentUserId, staleIds));
        await db.update(users).set({ isActive: false, familyCode: null }).where(inArray(users.id, staleIds));
        logger.info(
            `[staff sweep] ${staleStaff.length} staff account(s) stale (>${cutoffHours}h) — deactivated`,
            { externalIds: staleStaff.map((s) => s.externalId) },
        );
    }

    return {
        staffSwept: staleStaff.length,
        externalIdsSwept: staleStaff.map((s) => s.externalId ?? ""),
    };
}
