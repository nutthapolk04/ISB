import { describe, expect, test } from 'bun:test';
import {
    CASH_IDLE_DISPLAY_SEC,
    CASH_IDLE_GRACE_SEC,
    CASH_IDLE_TOTAL_SEC,
    cashDisplayTime,
    cashIdleHoldSeconds,
    cashProgress,
    resolveCashIdleExpiry,
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
});
