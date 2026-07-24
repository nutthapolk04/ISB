import { sweepOfflineKiosks } from "./kiosk_monitoring_service";
import { logger } from "@/logger";

/**
 * Periodic sweep for kiosks that have gone silent past the offline threshold
 * (see kiosk_monitoring_service.ts::OFFLINE_THRESHOLD_MINUTES). Runs every
 * minute so a real outage is detected and notified within roughly a minute
 * of crossing the threshold, without needing cron/job-queue infra — mirrors
 * low_balance_scheduler.ts / topup_reconcile_scheduler.ts's setInterval
 * pattern, the established way this codebase runs background sweeps.
 */
const INTERVAL_MS = 60_000;

let running = false;

export function startKioskHealthScheduler(): void {
    setInterval(async () => {
        if (running) return; // a slow sweep is still in flight — skip this tick
        running = true;
        try {
            const { flagged } = await sweepOfflineKiosks();
            if (flagged > 0) {
                logger.info(`[kiosk-health] flagged ${flagged} kiosk(s) as offline`);
            }
        } catch (e) {
            logger.error("[kiosk-health] sweep failed", e);
        } finally {
            running = false;
        }
    }, INTERVAL_MS);
}
