import { describe, expect, test, beforeEach } from 'bun:test';
import {
    enterOutOfService,
    getOutOfServiceState,
    isOutOfService,
    unlockOutOfService,
    __test__setOutOfServiceState,
} from '../src/lib/kioskOutOfService';
import type { RecoveryTopupSnapshot } from '../src/lib/recoveryReceipt';

const snapshot: RecoveryTopupSnapshot = {
    method: 'CASH',
    ref: 'ref-123',
    payer_id: 'P001',
    receiver_id: 'R001',
    actual_amount: 500,
    target_amount: 500,
    transaction_id: null,
    recorded_at: '2026-07-30T10:00:00.000Z',
};

describe('kioskOutOfService', () => {
    beforeEach(() => {
        __test__setOutOfServiceState(null);
    });

    test('enter sets active flag', () => {
        expect(isOutOfService()).toBe(false);
        enterOutOfService(snapshot);
        expect(isOutOfService()).toBe(true);
    });

    test('enter preserves lockLogged on reboot', () => {
        __test__setOutOfServiceState({
            active: true,
            lockLogged: true,
            lockedAt: '2026-07-30T10:00:00.000Z',
            snapshot,
        });
        enterOutOfService({ ...snapshot, ref: 'ref-updated' });
        const state = getOutOfServiceState();
        expect(state?.lockLogged).toBe(true);
        expect(state?.snapshot?.ref).toBe('ref-updated');
    });

    test('unlock clears state', () => {
        enterOutOfService(snapshot);
        unlockOutOfService();
        expect(isOutOfService()).toBe(false);
    });
});
