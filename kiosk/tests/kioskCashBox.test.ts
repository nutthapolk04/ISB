import { describe, expect, test, beforeEach } from 'bun:test';
import {
    __test__resetCashBox,
    buildCashBoxClearSnapshot,
    commitCashBoxClear,
    getCashBoxTotal,
    recordStackedBill,
} from '../src/lib/kioskCashBox';

describe('kioskCashBox', () => {
    beforeEach(() => {
        __test__resetCashBox();
    });

    test('recordStackedBill increments denominations', () => {
        recordStackedBill(1000);
        recordStackedBill(500);
        recordStackedBill(100);
        recordStackedBill(100);

        const snapshot = buildCashBoxClearSnapshot();
        expect(snapshot.bills[1000]).toBe(1);
        expect(snapshot.bills[500]).toBe(1);
        expect(snapshot.bills[100]).toBe(2);
        expect(snapshot.amount).toBe(1000 + 500 + 200);
    });

    test('getCashBoxTotal sums correctly', () => {
        expect(getCashBoxTotal({ 1000: 7, 500: 5, 100: 5 })).toBe(10000);
    });

    test('commitCashBoxClear resets counts', () => {
        recordStackedBill(1000);
        const snapshot = buildCashBoxClearSnapshot();
        commitCashBoxClear(snapshot);
        expect(buildCashBoxClearSnapshot().amount).toBe(0);
        expect(buildCashBoxClearSnapshot().bills[1000]).toBeUndefined();
    });

    test('buildCashBoxClearSnapshot captures current counts', () => {
        recordStackedBill(500);
        recordStackedBill(500);
        const snapshot = buildCashBoxClearSnapshot();
        expect(snapshot.amount).toBe(1000);
        expect(snapshot.bills[500]).toBe(2);
        expect(snapshot.clearedAt).toBeTruthy();
    });
});
