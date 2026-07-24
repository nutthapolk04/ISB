/**
 * Liveness ping — tells the backend this kiosk process is up and has
 * network, independent of whether a member is currently tapped in (see
 * backend-bun/src/services/kiosk_monitoring_service.ts). If the backend
 * stops hearing from this kiosk for more than the offline threshold
 * (currently 5 minutes), it notifies the kiosk's assigned custodians —
 * this interval must run comfortably more often than that threshold so a
 * single dropped ping doesn't false-positive an outage.
 *
 * Best-effort like kioskLogUploader.ts — a failed ping is silently retried
 * next tick and must never surface an error to the cashier/parent-facing UI.
 */
import { realApi } from '../api/realApi';
import { logKioskEvent } from './kioskLog';

const HEARTBEAT_INTERVAL_MS = 60 * 1000; // 1 minute

async function sendHeartbeat(): Promise<void> {
    try {
        await realApi.sendHeartbeat();
    } catch (e) {
        logKioskEvent('system', 'warn', 'Heartbeat failed', {
            error: e instanceof Error ? e.message : String(e),
        });
    }
}

let intervalId: number | null = null;

/** Starts the periodic heartbeat. Idempotent — calling it twice (e.g. a hot
 * reload during dev) doesn't stack intervals. */
export function startKioskHeartbeat(): void {
    if (intervalId !== null) return;
    void sendHeartbeat();
    intervalId = window.setInterval(() => {
        void sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
}
