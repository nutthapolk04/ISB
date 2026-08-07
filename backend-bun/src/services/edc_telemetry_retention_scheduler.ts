import { pruneEdcTelemetry } from "./edc_telemetry_service";
import { logger } from "@/logger";

/**
 * Two-stage retention for `edc_txn_events`.
 *
 * The two halves of a row have very different lifetimes:
 *
 *   `cart_snapshot` carries identifiers for the person who bought (customer_id
 *   / user_id / external_id). It is the reason this table holds any personal
 *   data at all, and it stops being useful once an incident has been dealt
 *   with — so it is cleared after 30 days.
 *
 *   Everything else (amount, POS reference, approval code, response code) is
 *   the terminal's side of the conversation and carries no personal data. A
 *   card dispute or a bank reconciliation query can surface months later, so
 *   the row itself is kept for a year — deleting it would leave nothing to
 *   confirm the transaction ever happened.
 *
 * Runs on setInterval like low_balance_scheduler / kiosk_health_scheduler —
 * the established way this codebase runs background sweeps, no cron infra.
 */
const INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h; nothing here is time-critical

let running = false;

export function startEdcTelemetryRetentionScheduler(): void {
    // Fire once shortly after boot as well, so a long-running deployment that
    // never reaches the first tick still prunes.
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const { snapshotsCleared, rowsDeleted } = await pruneEdcTelemetry();
            if (snapshotsCleared > 0 || rowsDeleted > 0) {
                logger.info("[edc-retention] pruned", { snapshotsCleared, rowsDeleted });
            }
        } catch (e) {
            logger.error("[edc-retention] prune failed", e);
        } finally {
            running = false;
        }
    };

    setTimeout(() => void tick(), 60_000);
    setInterval(() => void tick(), INTERVAL_MS);
}
