/**
 * Liveness ping — tells the backend this kiosk process is up and has
 * network (see backend-bun/src/services/kiosk_monitoring_service.ts).
 */
import { realApi } from '../api/realApi';
import { auditPingFailed } from './kioskAuditLog';

const HEARTBEAT_INTERVAL_MS = 60 * 1000; // 1 minute

async function sendHeartbeat(): Promise<void> {
    try {
        await realApi.sendHeartbeat();
    } catch (e) {
        auditPingFailed(e instanceof Error ? e.message : String(e));
    }
}

let intervalId: number | null = null;

export function startKioskHeartbeat(): void {
    if (intervalId !== null) return;
    void sendHeartbeat();
    intervalId = window.setInterval(() => {
        void sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
}
