import { describe, expect, test, beforeEach } from 'bun:test';
import {
    __test__dispatchBillEvent,
    __test__readBillAcceptorState,
    __test__resetBillAcceptorState,
} from '../src/hooks/useBillAcceptor';
import { __test__resetCashBox, buildCashBoxClearSnapshot } from '../src/lib/kioskCashBox';
import { __test__resetCashBoxStackReturn } from '../src/lib/cashBoxStackReturn';

describe('bill acceptor cash-box stack/return', () => {
    beforeEach(() => {
        __test__resetBillAcceptorState();
        __test__resetCashBox();
        __test__resetCashBoxStackReturn();
    });

    test('in-flight stacked then returned keeps counter at zero', () => {
        __test__dispatchBillEvent({
            type: 'stacked',
            billAmountThb: 500,
            collectedThb: 500,
            message: 'In-flight bill credited after disable — 500 THB (total 500)',
        });
        expect(buildCashBoxClearSnapshot().bills[500]).toBeUndefined();

        __test__dispatchBillEvent({
            type: 'returned',
            billAmountThb: 500,
            collectedThb: 0,
        });
        expect(buildCashBoxClearSnapshot().bills[500]).toBeUndefined();
        expect(__test__readBillAcceptorState().stackedBills[500]).toBeUndefined();
    });

    test('real stacked then returned adjusts counter and session bills', () => {
        __test__dispatchBillEvent({
            type: 'stacked',
            billAmountThb: 500,
            collectedThb: 500,
            message: 'Bill stacked — 500 THB (total 500)',
        });
        expect(buildCashBoxClearSnapshot().bills[500]).toBe(1);

        __test__dispatchBillEvent({
            type: 'returned',
            billAmountThb: 500,
            collectedThb: 0,
        });
        expect(buildCashBoxClearSnapshot().bills[500]).toBeUndefined();
        expect(__test__readBillAcceptorState().stackedBills[500]).toBeUndefined();
    });
});
