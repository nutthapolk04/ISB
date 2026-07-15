/**
 * Staleness-based family reconciliation.
 *
 * ISB's vendor sync never signals "this is the last batch of the run" —
 * batches are independent HTTP calls, arbitrary order, no batch-count field
 * (confirmed 2026-07). So a family_code missing from any single
 * processFamilyBatch() call can't safely be treated as "ISB stopped
 * reporting it" — it might just be sitting in a batch that hasn't landed
 * yet. Doing that per-call would deactivate most of the school every sync
 * (a 3-batch run of 1211 families would treat batch 1's 500 families as
 * "the only real ones" the moment it lands).
 *
 * This sweep uses TIME instead: `family_profiles.lastSyncedAt` is touched
 * ONLY by upsertFamilyProfile() (the family-batch path, never the separate
 * staff-batch path) — so a family_code whose lastSyncedAt is older than a
 * full sync cycle's worth of margin is safe to treat as genuinely gone. No
 * family-batch call in a long while has mentioned it at all.
 *
 * Deliberately does NOT use `users.lastSyncedAt` for the parent/staff side —
 * that column is shared with the independent /sync/staffs channel
 * (upsertStaff touches the same field), so it can stay "fresh" purely from
 * staff-batch activity even once this person's family_code should be
 * cleared. `family_profiles.lastSyncedAt` is the one signal that's
 * exclusively family-batch-owned, which is what we actually need here.
 *
 * End state per stale family_code (mirrors reconcileFamilyMembership's
 * per-batch orphan/deactivate split — see powerschool_sync.ts):
 *   - family_profiles.is_active = false
 *   - every "parent"/"staff" role user still tagged with this family_code:
 *     drop their parent_child_links and clear family_code (orphaned — they
 *     keep their own login/wallet; a Staff person stays an active Staff
 *     account, just detached from this family, matching the Staff+Parent
 *     case discussed). manager/cashier/admin/kiosk are app-created, never
 *     ISB-sync data, and are excluded even if one somehow has a family_code.
 *   - every student customer still tagged with this family_code: drop
 *     parent_child_links, clear family_code, AND deactivate (is_active =
 *     false) — a student with no family left shouldn't keep spending at POS.
 *
 * Both reactivate automatically the next time ISB reports them again
 * (upsertFamilyProfile sets is_active=true on every touch; upsertStudent
 * re-activates a returning student — see powerschool_sync.ts).
 *
 * Cadence (confirmed 2026-07): ISB re-syncs the FULL current dataset every
 * hour, chunked into several batches per hour so the server isn't hit with
 * everything at once — not a delta feed. RECENT_ACTIVITY_WINDOW_HOURS and
 * the scheduler's default cutoff are sized off that: comfortably more than
 * one hourly cycle's worth of margin (covering a slow/retried run) without
 * waiting anywhere near a full day to notice a real removal.
 */
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { customers, familyProfiles, parentChildLinks, users } from "@/db/schema";
import { logger } from "@/logger";

export interface FamilySweepResult {
    familiesSwept: number;
    parentsOrphaned: number;
    studentsDeactivated: number;
    familyCodesSwept: string[];
    skippedNoRecentActivity?: boolean;
}

// "family_profiles.lastSyncedAt is old" has two possible causes: (a) ISB
// genuinely stopped reporting THIS ONE family — the case this sweep exists
// to catch — or (b) ISB's whole sync pipeline hasn't run at all in a while
// (an outage, a paused cron, a config mistake), which would make EVERY
// family look equally stale and get mass-deactivated for a reason that has
// nothing to do with any family actually being removed. (b) is the more
// dangerous failure mode by far — confirmed empirically: a first pass of
// this sweep with no such gate deactivated 8 real demo families in the
// local dev DB whose family_profiles rows simply predated ever being
// touched by a real sync, alongside the 3 that were genuinely intentional
// test fixtures. Require positive proof the pipeline is alive *right now*
// (something touched recently) before treating anything as stale. 2h covers
// two full hourly cycles of margin.
const RECENT_ACTIVITY_WINDOW_HOURS = 2;

export async function sweepStaleFamilies(cutoffHours: number): Promise<FamilySweepResult> {
    const cutoff = new Date(Date.now() - cutoffHours * 60 * 60 * 1000).toISOString();

    const recentActivityCutoff = new Date(Date.now() - RECENT_ACTIVITY_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const recentlyActive = await db
        .select({ familyCode: familyProfiles.familyCode })
        .from(familyProfiles)
        .where(gte(familyProfiles.lastSyncedAt, recentActivityCutoff))
        .limit(1);
    if (recentlyActive.length === 0) {
        logger.warn(
            `[family sweep] skipped — no family_profiles touched in the last ${RECENT_ACTIVITY_WINDOW_HOURS}h; ` +
            "ISB's sync pipeline may be paused/down. Refusing to sweep blind rather than risk mass-deactivating everyone.",
        );
        return { familiesSwept: 0, parentsOrphaned: 0, studentsDeactivated: 0, familyCodesSwept: [], skippedNoRecentActivity: true };
    }

    const staleFamilies = await db
        .select({ familyCode: familyProfiles.familyCode })
        .from(familyProfiles)
        .where(and(eq(familyProfiles.isActive, true), lt(familyProfiles.lastSyncedAt, cutoff)));

    let parentsOrphaned = 0;
    let studentsDeactivated = 0;

    for (const { familyCode } of staleFamilies) {
        await db.update(familyProfiles).set({ isActive: false }).where(eq(familyProfiles.familyCode, familyCode));

        // Only "parent"/"staff" are ISB-sync-managed roles — manager,
        // cashier, admin, kiosk (and student, handled separately below) are
        // created inside the app itself and must never be touched here even
        // if one somehow has a family_code set.
        const staleParents = await db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.familyCode, familyCode), inArray(users.role, ["parent", "staff"])));
        if (staleParents.length > 0) {
            const staleIds = staleParents.map((p) => p.id);
            await db.delete(parentChildLinks).where(inArray(parentChildLinks.parentUserId, staleIds));
            await db.update(users).set({ familyCode: null }).where(inArray(users.id, staleIds));
            parentsOrphaned += staleIds.length;
        }

        const staleStudents = await db
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.familyCode, familyCode), eq(customers.customerKind, "student")));
        if (staleStudents.length > 0) {
            const staleIds = staleStudents.map((s) => s.id);
            await db.delete(parentChildLinks).where(inArray(parentChildLinks.childCustomerId, staleIds));
            await db.update(customers).set({ familyCode: null, isActive: false }).where(inArray(customers.id, staleIds));
            studentsDeactivated += staleIds.length;
        }
    }

    const familyCodesSwept = staleFamilies.map((f) => f.familyCode);
    if (familyCodesSwept.length > 0) {
        logger.info(
            `[family sweep] ${familyCodesSwept.length} family_code(s) stale (>${cutoffHours}h) — ` +
            `${parentsOrphaned} parent/staff orphaned, ${studentsDeactivated} student(s) deactivated`,
            { familyCodes: familyCodesSwept },
        );
    }

    return { familiesSwept: familyCodesSwept.length, parentsOrphaned, studentsDeactivated, familyCodesSwept };
}
