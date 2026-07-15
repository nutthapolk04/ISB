import { reconcilePendingTopups } from "./topup_service";
import { logger } from "@/logger";

/**
 * Damage-control net for the created_by=null top-up hotfix: periodically
 * sweeps for top-up intents stuck `pending` past a threshold and credits
 * anything BAY confirms COMPLETED, the same way the /admin/topups/reconcile
 * endpoint does (real run, not dry — this is the automated safety net;
 * dryRun is for the manual damage-assessment call).
 *
 * Mirrors low_balance_scheduler.ts's setInterval pattern — this codebase has
 * no cron/job-queue infra, so this is the established way to run a periodic
 * background sweep.
 */
const INTERVAL_MS = 10 * 60_000; // every 10 minutes
const OLDER_THAN_MINUTES = 15;
const LIMIT = 50;

let running = false;

export function startTopupReconcileScheduler(): void {
    setInterval(async () => {
        if (running) return; // a slow sweep is still in flight — skip this tick
        running = true;
        try {
            const summary = await reconcilePendingTopups({
                olderThanMinutes: OLDER_THAN_MINUTES,
                limit: LIMIT,
                dryRun: false,
            });
            if (summary.credited.length > 0 || summary.failed.length > 0) {
                logger.info(
                    `[topup-reconcile] scanned=${summary.scanned} credited=${summary.credited.length} ` +
                    `failed=${summary.failed.length} skipped=${summary.skipped.length}`,
                );
            }
        } catch (e) {
            logger.error("[topup-reconcile] sweep failed", e);
        } finally {
            running = false;
        }
    }, INTERVAL_MS);
}
