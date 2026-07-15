import { sweepStaleFamilies } from "./family_sweep_service";
import { sweepStaleStaff } from "./staff_sweep_service";
import { sweepStaleDepartments } from "./department_sweep_service";
import { logger } from "@/logger";

// How often the sweeps run. Sweeping is idempotent (re-running with the same
// cutoff just re-checks the same-or-fewer stale rows), so this just needs to
// be "often enough that a genuine ISB-side removal is cleaned up reasonably
// promptly". Set to match ISB's own hourly cadence (confirmed 2026-07: full
// dataset re-synced every hour across families/staff/departments, chunked
// into several batches per hour) so detection lag stays close to one cycle.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// How stale a row's own sync timestamp must be before it's treated as
// "ISB stopped reporting it". ISB re-syncs the full dataset every hour
// (confirmed 2026-07) — 3h comfortably covers one slow/retried hourly cycle's
// worth of margin (a run landing up to 2h late) without waiting anywhere
// near a full day to notice a real removal. Override via env var if the
// real cadence turns out to need a different margin.
const DEFAULT_CUTOFF_HOURS = 3;

/**
 * Runs all three ISB-sync staleness sweeps on the same tick — family
 * membership (orphan parent/staff, deactivate student), staff (deactivate),
 * department (deactivate). Each has its own "is the pipeline actually alive
 * right now" safety gate (see the individual services) and silently skips
 * itself if not, so one channel being quiet doesn't block the others.
 */
export function startIsbSyncSweepScheduler(): void {
    const cutoffHours = Number(process.env.ISB_SYNC_SWEEP_CUTOFF_HOURS ?? DEFAULT_CUTOFF_HOURS);
    setInterval(() => {
        sweepStaleFamilies(cutoffHours).catch((err) => {
            logger.error("[family sweep] scheduler tick failed", err);
        });
        sweepStaleStaff(cutoffHours).catch((err) => {
            logger.error("[staff sweep] scheduler tick failed", err);
        });
        sweepStaleDepartments(cutoffHours).catch((err) => {
            logger.error("[department sweep] scheduler tick failed", err);
        });
    }, SWEEP_INTERVAL_MS);
}
