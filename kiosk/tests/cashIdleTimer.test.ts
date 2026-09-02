import { describe, expect, test } from 'bun:test';
import {
    CASH_IDLE_ACCEPT_CUTOFF_SEC,
    CASH_IDLE_DISPLAY_SEC,
    CASH_IDLE_GRACE_SEC,
    CASH_IDLE_TOTAL_SEC,
    cashAcceptCutoffTimeLeft,
    cashDisplayTime,
    cashIdleHoldSeconds,
    cashProgress,
    isCashAcceptCutoff,
    resolveCashIdleExpiry,
    shouldResetCashIdleTimer,
    shouldSkipIdleCountdownTick,
} from '../src/lib/cashIdleTimer';

describe('cashIdleTimer', () => {
    test('constants: 15s visible + 5s grace = 20s total', () => {
        expect(CASH_IDLE_TOTAL_SEC).toBe(20);
        expect(CASH_IDLE_DISPLAY_SEC).toBe(15);
        expect(CASH_IDLE_GRACE_SEC).toBe(5);
    });

    test('cashDisplayTime shows 0 during grace window', () => {
        expect(cashDisplayTime(20)).toBe(15);
        expect(cashDisplayTime(6)).toBe(1);
        expect(cashDisplayTime(5)).toBe(0);
        expect(cashDisplayTime(1)).toBe(0);
        expect(cashDisplayTime(0)).toBe(0);
    });

    test('cashProgress reaches 0 at end of visible countdown', () => {
        expect(cashProgress(20)).toBeCloseTo(1);
        expect(cashProgress(5)).toBe(0);
    });

    test('hold idle expiry while bill is in flight', () => {
        expect(resolveCashIdleExpiry(true)).toBe('hold');
        expect(resolveCashIdleExpiry(false)).toBe('proceed');
    });

    test('skip countdown ticks while bill is in flight', () => {
        expect(shouldSkipIdleCountdownTick(true)).toBe(true);
        expect(shouldSkipIdleCountdownTick(false)).toBe(false);
    });

    test('hold sentinel keeps grace window alive', () => {
        expect(cashIdleHoldSeconds()).toBe(1);
    });

    test('accept cutoff: last 3 visible seconds, not during grace', () => {
        expect(CASH_IDLE_ACCEPT_CUTOFF_SEC).toBe(3);
        expect(cashAcceptCutoffTimeLeft()).toBe(8);
        expect(isCashAcceptCutoff(9)).toBe(false);
        expect(isCashAcceptCutoff(8)).toBe(true);
        expect(isCashAcceptCutoff(6)).toBe(true);
        expect(isCashAcceptCutoff(5)).toBe(false);
        expect(isCashAcceptCutoff(0)).toBe(false);
    });

    test('shouldResetCashIdleTimer is false during accept cutoff', () => {
        expect(shouldResetCashIdleTimer(20)).toBe(true);
        expect(shouldResetCashIdleTimer(8)).toBe(false);
        expect(shouldResetCashIdleTimer(5)).toBe(true);
    });
});
