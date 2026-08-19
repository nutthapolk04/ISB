import { describe, expect, test } from 'bun:test';
import { applyBillInFlight } from '../src/hooks/useBillAcceptor';

describe('applyBillInFlight', () => {
    test('escrow / accept / overpay mark a bill in flight', () => {
        expect(applyBillInFlight('escrowPending', false)).toBe(true);
        expect(applyBillInFlight('accepted', false)).toBe(true);
        expect(applyBillInFlight('overpayPending', false)).toBe(true);
    });

    test('stacked / returned / complete clear in-flight', () => {
        expect(applyBillInFlight('stacked', true)).toBe(false);
        expect(applyBillInFlight('returned', true)).toBe(false);
        expect(applyBillInFlight('collectComplete', true)).toBe(false);
    });

    test('reject exception does not clear in-flight (wait for returned)', () => {
        expect(applyBillInFlight('exception', true)).toBe(true);
        expect(applyBillInFlight('error', false)).toBe(false);
    });
});
