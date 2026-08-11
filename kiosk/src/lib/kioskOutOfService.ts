import { auditLock, auditUnlock } from './kioskAuditLog';
import type { RecoveryTopupSnapshot } from './recoveryReceipt';

const OOS_KEY = 'kiosk-out-of-service';

export interface OutOfServiceState {
    active: boolean;
    lockLogged: boolean;
    lockedAt: string;
    snapshot?: RecoveryTopupSnapshot;
}

let memoryOosState: OutOfServiceState | null = null;

function readState(): OutOfServiceState | null {
    if (memoryOosState) return memoryOosState;
    try {
        const raw = localStorage.getItem(OOS_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as OutOfServiceState;
    } catch {
        return null;
    }
}

function writeState(state: OutOfServiceState | null): void {
    memoryOosState = state?.active ? state : null;
    try {
        if (!state?.active) {
            localStorage.removeItem(OOS_KEY);
            return;
        }
        localStorage.setItem(OOS_KEY, JSON.stringify(state));
    } catch {
        /* memoryOosState still holds the flag */
    }
}

export function isOutOfService(): boolean {
    return readState()?.active === true;
}

export function getOutOfServiceState(): OutOfServiceState | null {
    const state = readState();
    return state?.active ? state : null;
}

export function enterOutOfService(snapshot: RecoveryTopupSnapshot): void {
    const existing = readState();
    const state: OutOfServiceState = {
        active: true,
        lockLogged: existing?.lockLogged ?? false,
        lockedAt: existing?.lockedAt ?? new Date().toISOString(),
        snapshot,
    };

    if (!state.lockLogged) {
        auditLock({
            ref: snapshot.ref,
            method: snapshot.method,
            payer_id: snapshot.payer_id,
            receiver_id: snapshot.receiver_id,
            actual_amount: snapshot.actual_amount,
        });
        state.lockLogged = true;
    }

    writeState(state);
}

export function unlockOutOfService(): void {
    const state = readState();
    if (state?.snapshot) {
        auditUnlock({
            ref: state.snapshot.ref,
            method: state.snapshot.method,
            payer_id: state.snapshot.payer_id,
            receiver_id: state.snapshot.receiver_id,
            actual_amount: state.snapshot.actual_amount,
        });
    } else {
        auditUnlock({});
    }
    writeState(null);
}

/** @internal — tests only */
export function __test__setOutOfServiceState(state: OutOfServiceState | null): void {
    memoryOosState = null;
    writeState(state);
}
