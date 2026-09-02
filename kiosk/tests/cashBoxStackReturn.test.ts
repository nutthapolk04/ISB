import { describe, expect, test, beforeEach } from 'bun:test';
import {
    __test__readCashBoxStackReturnState,
    __test__resetCashBoxStackReturn,
    flushPendingInFlightStacksToCounter,
    isInFlightStackedBillEvent,
    onBillReturnedForCashBox,
    onBillStackedForCashBox,
} from '../src/lib/cashBoxStackReturn';
import {
    __test__resetCashBox,
    buildCashBoxClearSnapshot,
    recordReturnedBill,
    recordStackedBill,
} from '../src/lib/kioskCashBox';

describe('isInFlightStackedBillEvent', () => {
    test('detects native in-flight stack message', () => {
        expect(isInFlightStackedBillEvent('In-flight bill credited after disable — 500 THB (total 500)')).toBe(true);
        expect(isInFlightStackedBillEvent('Bill stacked — 500 THB (total 500)')).toBe(false);
    });
});

describe('cashBoxStackReturn', () => {
    beforeEach(() => {
        __test__resetCashBox();
        __test__resetCashBoxStackReturn();
    });

    test('real stack increments counter immediately', () => {
        onBillStackedForCashBox(500, false);
        expect(buildCashBoxClearSnapshot().bills[500]).toBe(1);
        expect(__test__readCashBoxStackReturnState().pendingInFlight).toEqual([]);
    });

    test('in-flight stack then return does not change counter (phantom 500 fix)', () => {
        onBillStackedForCashBox(500, true);
        expect(buildCashBoxClearSnapshot().bills[500]).toBeUndefined();

        onBillReturnedForCashBox(500);
        expect(buildCashBoxClearSnapshot().bills[500]).toBeUndefined();
        expect(__test__readCashBoxStackReturnState().pendingInFlight).toEqual([]);
    });

    test('in-flight stack then flush credits counter when bill stays in box', () => {
        onBillStackedForCashBox(500, true);
        flushPendingInFlightStacksToCounter();
        expect(buildCashBoxClearSnapshot().bills[500]).toBe(1);
    });

    test('real stack then return decrements counter', () => {
        onBillStackedForCashBox(500, false);
        onBillReturnedForCashBox(500);
        expect(buildCashBoxClearSnapshot().bills[500]).toBeUndefined();
    });

    test('escrow return without prior stack does not decrement counter', () => {
        recordStackedBill(500);
        onBillReturnedForCashBox(500);
        expect(buildCashBoxClearSnapshot().bills[500]).toBe(1);
    });
});

describe('recordReturnedBill', () => {
    beforeEach(() => {
        __test__resetCashBox();
    });

    test('decrements denomination and floors at zero', () => {
        recordStackedBill(500);
        recordStackedBill(500);
        recordReturnedBill(500);
        expect(buildCashBoxClearSnapshot().bills[500]).toBe(1);

        recordReturnedBill(500);
        expect(buildCashBoxClearSnapshot().bills[500]).toBeUndefined();

        recordReturnedBill(500);
        expect(buildCashBoxClearSnapshot().amount).toBe(0);
    });
});
