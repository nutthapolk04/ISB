/**
 * Heartbeat audit state — log PING failed on each error, and a single PING
 * recovered after the latest failure once connectivity returns.
 */
import { auditPingFailed, auditPingRecovered } from './kioskAuditLog';

export type PingAuditEmit = 'failed' | 'recovered' | null;

/** Pure transition — used by onHeartbeat* and unit tests. */
export function derivePingAuditAction(
    wasFailing: boolean,
    outcome: 'success' | 'failure',
): { nextWasFailing: boolean; emit: PingAuditEmit } {
    if (outcome === 'failure') {
        return { nextWasFailing: true, emit: 'failed' };
    }
    if (wasFailing) {
        return { nextWasFailing: false, emit: 'recovered' };
    }
    return { nextWasFailing: false, emit: null };
}

let pingWasFailing = false;

export function onHeartbeatSuccess(): void {
    const { nextWasFailing, emit } = derivePingAuditAction(pingWasFailing, 'success');
    pingWasFailing = nextWasFailing;
    if (emit === 'recovered') auditPingRecovered();
}

export function onHeartbeatFailure(error?: string): void {
    const { nextWasFailing, emit } = derivePingAuditAction(pingWasFailing, 'failure');
    pingWasFailing = nextWasFailing;
    if (emit === 'failed') auditPingFailed(error);
}

/** @internal — reset module state between unit tests */
export function resetPingAuditStateForTests(): void {
    pingWasFailing = false;
}
