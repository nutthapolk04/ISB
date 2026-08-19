import { describe, expect, test, beforeEach, mock } from 'bun:test';
import type { BillEvent } from 'capacitor-hardware';
import { applyBillInFlight } from '../src/hooks/useBillAcceptor';
import {
    resolveCashCreditAmount,
    shouldStartCashFinalize,
} from '../src/lib/cashTopupFinalize';
import {
    resolveCashIdleExpiry,
    shouldSkipIdleCountdownTick,
} from '../src/lib/cashIdleTimer';

type BillListener = (event: BillEvent) => void;

let billListener: BillListener | null = null;

mock.module('capacitor-hardware', () => ({
    Hardware: {
        addListener: async (_event: string, cb: BillListener) => {
            billListener = cb;
            return { remove: async () => { billListener = null; } };
        },
        startCollecting: async () => {},
        stopCollecting: async () => {
            // Native waits for in-flight escrow, then emits the final stack + complete.
            billListener?.({
                type: 'stacked',
                rawHex: '',
                billAmountThb: 1000,
                collectedThb: 2000,
                targetThb: 2000,
            });
            billListener?.({
                type: 'collectComplete',
                rawHex: '',
                collectedThb: 2000,
                targetThb: 2000,
            });
        },
        acceptBill: async () => {},
        returnBill: async () => {},
    },
}));

const {
    __test__dispatchBillEvent,
    __test__readBillAcceptorState,
    __test__resetBillAcceptorState,
    useBillAcceptor,
} = await import('../src/hooks/useBillAcceptor');

/** Replays the reported 2000-target / two-1000-bills incident (first stack, reject cycle, second stack). */
function replayTwoThousandIncident() {
    let inFlight = false;

    __test__dispatchBillEvent({
        type: 'collecting',
        rawHex: '',
        targetThb: 2000,
        collectedThb: 0,
    });

    inFlight = applyBillInFlight('stacked', inFlight);
    __test__dispatchBillEvent({
        type: 'stacked',
        rawHex: '',
        billAmountThb: 1000,
        collectedThb: 1000,
        targetThb: 2000,
    });
    expect(inFlight).toBe(false);

    inFlight = applyBillInFlight('escrowPending', inFlight);
    __test__dispatchBillEvent({ type: 'escrowPending', rawHex: '', collectedThb: 1000, targetThb: 2000 });
    expect(inFlight).toBe(true);

    inFlight = applyBillInFlight('exception', inFlight);
    __test__dispatchBillEvent({ type: 'exception', rawHex: '', message: 'reject' });
    expect(inFlight).toBe(true);

    inFlight = applyBillInFlight('escrowPending', inFlight);
    __test__dispatchBillEvent({ type: 'escrowPending', rawHex: '', collectedThb: 1000, targetThb: 2000 });

    inFlight = applyBillInFlight('accepted', inFlight);
    __test__dispatchBillEvent({ type: 'accepted', rawHex: '', collectedThb: 1000, targetThb: 2000 });

    inFlight = applyBillInFlight('stacked', inFlight);
    __test__dispatchBillEvent({
        type: 'stacked',
        rawHex: '',
        billAmountThb: 1000,
        collectedThb: 2000,
        targetThb: 2000,
    });
    expect(inFlight).toBe(false);

    __test__dispatchBillEvent({
        type: 'collectComplete',
        rawHex: '',
        collectedThb: 2000,
        targetThb: 2000,
    });

    return __test__readBillAcceptorState();
}

describe('cashTopupFinalize helpers', () => {
    test('resolveCashCreditAmount uses post-stop total', () => {
        expect(resolveCashCreditAmount(2000)).toBe(2000);
        expect(resolveCashCreditAmount(1000)).toBe(1000);
    });

    test('shouldStartCashFinalize prevents double finalize', () => {
        expect(shouldStartCashFinalize(false)).toBe(true);
        expect(shouldStartCashFinalize(true)).toBe(false);
    });
});

describe('2000 THB target — two 1000 bills (reject cycle on second)', () => {
    beforeEach(() => {
        __test__resetBillAcceptorState();
        billListener = null;
    });

    test('idle timer holds while second bill is in flight after first stack', () => {
        replayTwoThousandIncident();

        let inFlight = false;
        inFlight = applyBillInFlight('stacked', inFlight);
        inFlight = applyBillInFlight('escrowPending', inFlight);
        expect(resolveCashIdleExpiry(inFlight)).toBe('hold');
        expect(shouldSkipIdleCountdownTick(inFlight)).toBe(true);

        inFlight = applyBillInFlight('exception', inFlight);
        expect(resolveCashIdleExpiry(inFlight)).toBe('hold');
    });

    test('pre-stop snapshot 1000 vs post-stop credit 2000 — bug would under-credit', () => {
        const stateMidSession = replayTwoThousandIncident();
        expect(stateMidSession.collectedThb).toBe(2000);

        const preStopSnapshot = 1000;
        expect(preStopSnapshot).not.toBe(stateMidSession.collectedThb);

        const credited = resolveCashCreditAmount(stateMidSession.collectedThb);
        expect(credited).toBe(2000);
    });

    test('stop() settles in-flight bill then collectedThb reflects full cashbox', async () => {
        const bill = useBillAcceptor();
        await bill.start(2000);

        __test__dispatchBillEvent({
            type: 'stacked',
            rawHex: '',
            billAmountThb: 1000,
            collectedThb: 1000,
            targetThb: 2000,
        });
        __test__dispatchBillEvent({
            type: 'accepted',
            rawHex: '',
            collectedThb: 1000,
            targetThb: 2000,
        });

        const preStop = __test__readBillAcceptorState().collectedThb;
        expect(preStop).toBe(1000);

        await bill.stop();

        const postStop = __test__readBillAcceptorState().collectedThb;
        expect(postStop).toBe(2000);
        expect(resolveCashCreditAmount(postStop)).toBe(2000);
        expect(resolveCashCreditAmount(postStop)).not.toBe(preStop);
    });
});

describe('other cash flows — no regression guards', () => {
    beforeEach(() => {
        __test__resetBillAcceptorState();
    });

    test('idle proceeds with zero collected (cancel path unchanged)', () => {
        expect(resolveCashIdleExpiry(false)).toBe('proceed');
        expect(resolveCashCreditAmount(0)).toBe(0);
    });

    test('overpay pending keeps bill in flight until resolved', () => {
        let inFlight = false;
        inFlight = applyBillInFlight('overpayPending', inFlight);
        expect(inFlight).toBe(true);
        expect(resolveCashIdleExpiry(inFlight)).toBe('hold');

        inFlight = applyBillInFlight('returned', inFlight);
        expect(inFlight).toBe(false);
    });

    test('collectComplete clears in-flight — auto-finalize can proceed', () => {
        let inFlight = true;
        inFlight = applyBillInFlight('collectComplete', inFlight);
        expect(inFlight).toBe(false);
        expect(resolveCashIdleExpiry(inFlight)).toBe('proceed');
    });
});
