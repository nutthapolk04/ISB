import { describe, expect, test, beforeEach, mock } from 'bun:test';
import type { RecoveryTopupSnapshot } from '../src/lib/recoveryReceipt';

const notifyKioskLock = mock(async () => ({ notified: 1 }));

mock.module('../src/api/realApi', () => ({
    realApi: {
        notifyKioskLock,
    },
}));

const { notifyCustodiansOfLock } = await import('../src/lib/kioskLockNotify');
const { enterOutOfService, __test__setOutOfServiceState } = await import('../src/lib/kioskOutOfService');

const snapshot: RecoveryTopupSnapshot = {
    method: 'CASH',
    ref: 'ref-lock-1',
    payer_id: 'P001',
    receiver_id: 'R001',
    actual_amount: 1000,
    target_amount: 1000,
    transaction_id: null,
    recorded_at: '2026-08-19T10:00:00.000Z',
};

describe('kioskLockNotify', () => {
    beforeEach(() => {
        notifyKioskLock.mockClear();
        __test__setOutOfServiceState(null);
    });

    test('notifyCustodiansOfLock posts lock payload', async () => {
        await notifyCustodiansOfLock(snapshot);
        expect(notifyKioskLock).toHaveBeenCalledTimes(1);
        expect(notifyKioskLock.mock.calls[0]?.[0]).toEqual({
            ref: 'ref-lock-1',
            method: 'CASH',
            payer_id: 'P001',
            receiver_id: 'R001',
            actual_amount: 1000,
            target_amount: 1000,
            locked_at: '2026-08-19T10:00:00.000Z',
        });
    });

    test('enterOutOfService notifies custodians once on first lock', async () => {
        enterOutOfService(snapshot);
        await new Promise((r) => setTimeout(r, 0));
        expect(notifyKioskLock).toHaveBeenCalledTimes(1);

        enterOutOfService({ ...snapshot, ref: 'ref-lock-2' });
        await new Promise((r) => setTimeout(r, 0));
        expect(notifyKioskLock).toHaveBeenCalledTimes(1);
    });
});
