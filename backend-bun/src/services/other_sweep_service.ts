/**
 * Staleness-based deactivation for ISB "other" cardholders (visitor purchase
 * cards). Same cutoff and same "a batch is a full active-state snapshot"
 * reasoning as staff_sweep_service.ts — a card absent from ISB's `others`
 * data is no longer a valid card.
 *
 * WHY THIS IS A SEPARATE SWEEP, not `inArray(users.role, ["staff", "other"])`
 * bolted onto the staff sweep:
 *
 * Both sweeps share the same safety gate — refuse to run at all if nothing
 * has been confirmed recently, so a paused/down pipeline can't deactivate
 * everybody. That gate is only meaningful when the rows it *samples* are the
 * rows it *protects*. Widening the staff sweep's role filter would leave a
 * single gate sampling both roles, so ordinary /sync/staffs traffic would
 * satisfy it and authorise a sweep of the "other" rows too — and on day one,
 * with /sync/others live but ISB not yet pushing to it, every visitor card's
 * last_synced_at is already older than the cutoff. The first staff sync
 * after deploy would deactivate every visitor card in one tick.
 *
 * Keeping the gate scoped per role means "have OTHER cards been confirmed
 * recently" is what decides whether OTHER cards may be swept. The cutoff and
 * window are deliberately identical to the staff sweep (2026-08 decision:
 * same criteria, same schedule — the sync cadence is the same channel).
 *
 * Unlike the staff sweep this does NOT clear family_code: for role "other"
 * that column is descriptive metadata only (every family-scoped
 * authorization and listing path excludes the role explicitly — see
 * upsertOther's header), so there is no privilege to revoke by nulling it,
 * and keeping it makes a deactivated card identifiable if ISB re-sends it.
 * Reactivates automatically the next time /sync/others names the card.
 */
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { logger } from "@/logger";

export interface OtherSweepResult {
    othersSwept: number;
    externalIdsSwept: string[];
    skippedNoRecentActivity?: boolean;
}

// Same value as staff_sweep_service.ts's, sized off ISB's confirmed hourly
// cadence. Kept as its own constant rather than imported so the two sweeps
// can be retuned independently if ISB's channels ever diverge.
const RECENT_ACTIVITY_WINDOW_HOURS = 2;

export async function sweepStaleOthers(cutoffHours: number): Promise<OtherSweepResult> {
    const cutoff = new Date(Date.now() - cutoffHours * 60 * 60 * 1000).toISOString();

    const recentActivityCutoff = new Date(Date.now() - RECENT_ACTIVITY_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const recentlyActive = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, "other"), gte(users.lastSyncedAt, recentActivityCutoff)))
        .limit(1);
    if (recentlyActive.length === 0) {
        logger.warn(
            `[other sweep] skipped — no "other" cardholder touched in the last ${RECENT_ACTIVITY_WINDOW_HOURS}h; ` +
            "ISB may not be pushing /sync/others yet, or its pipeline is paused/down. " +
            "Refusing to sweep blind rather than risk deactivating every visitor card.",
        );
        return { othersSwept: 0, externalIdsSwept: [], skippedNoRecentActivity: true };
    }

    const stale = await db
        .select({ id: users.id, externalId: users.externalId })
        .from(users)
        .where(and(eq(users.role, "other"), eq(users.isActive, true), lt(users.lastSyncedAt, cutoff)));

    if (stale.length > 0) {
        const staleIds = stale.map((s) => s.id);
        // `status` moves with `is_active` — two columns that must never drift
        // apart (same reason as upsertOther / staff_sweep_service).
        await db.update(users).set({ isActive: false, status: "inactive" }).where(inArray(users.id, staleIds));
        logger.info(
            `[other sweep] ${stale.length} visitor card(s) stale (>${cutoffHours}h) — deactivated`,
            { externalIds: stale.map((s) => s.externalId) },
        );
    }

    return {
        othersSwept: stale.length,
        externalIdsSwept: stale.map((s) => s.externalId ?? ""),
    };
}
