import { describe, expect, test, beforeEach, mock } from 'bun:test';

const auditPingFailed = mock(() => {});
const auditPingRecovered = mock(() => {});

mock.module('../src/lib/kioskAuditLog', () => ({
    auditPingFailed,
    auditPingRecovered,
}));

const {
    derivePingAuditAction,
    onHeartbeatFailure,
    onHeartbeatSuccess,
    resetPingAuditStateForTests,
} = await import('../src/lib/kioskPingAudit');

describe('derivePingAuditAction', () => {
    test('success while healthy emits nothing', () => {
        expect(derivePingAuditAction(false, 'success')).toEqual({
            nextWasFailing: false,
            emit: null,
        });
    });

    test('failure marks failing and emits failed', () => {
        expect(derivePingAuditAction(false, 'failure')).toEqual({
            nextWasFailing: true,
            emit: 'failed',
        });
        expect(derivePingAuditAction(true, 'failure')).toEqual({
            nextWasFailing: true,
            emit: 'failed',
        });
    });

    test('success after failure emits recovered once', () => {
        expect(derivePingAuditAction(true, 'success')).toEqual({
            nextWasFailing: false,
            emit: 'recovered',
        });
    });
});

describe('onHeartbeatSuccess / onHeartbeatFailure', () => {
    beforeEach(() => {
        resetPingAuditStateForTests();
        auditPingFailed.mockClear();
        auditPingRecovered.mockClear();
    });

    test('does not log recovered on first success', () => {
        onHeartbeatSuccess();
        expect(auditPingRecovered).not.toHaveBeenCalled();
        expect(auditPingFailed).not.toHaveBeenCalled();
    });

    test('logs failed then recovered once after outage', () => {
        onHeartbeatFailure('timeout');
        onHeartbeatFailure('timeout');
        expect(auditPingFailed).toHaveBeenCalledTimes(2);

        onHeartbeatSuccess();
        expect(auditPingRecovered).toHaveBeenCalledTimes(1);

        onHeartbeatSuccess();
        expect(auditPingRecovered).toHaveBeenCalledTimes(1);
    });

    test('flapping outage logs recovered after each fail streak', () => {
        onHeartbeatFailure('e1');
        onHeartbeatSuccess();
        expect(auditPingRecovered).toHaveBeenCalledTimes(1);

        onHeartbeatFailure('e2');
        onHeartbeatSuccess();
        expect(auditPingRecovered).toHaveBeenCalledTimes(2);
    });
});
