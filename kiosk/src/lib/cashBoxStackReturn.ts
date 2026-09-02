/**
 * Cash-box counter updates for bill stack / return events.
 *
 * Real stacks (0x10) credit the physical counter immediately. In-flight stacks
 * (native stopCollecting timeout before 0x10) stay pending until the bill is
 * returned (0x11) or the session confirms collection (flush).
 */
import type { BillDenom } from './kioskAuditLog';
import { recordReturnedBill, recordStackedBill } from './kioskCashBox';

export const IN_FLIGHT_STACKED_MESSAGE = 'In-flight bill credited after disable';

export function isInFlightStackedBillEvent(message?: string): boolean {
    return message?.includes(IN_FLIGHT_STACKED_MESSAGE) ?? false;
}

/** Denominations counted on the cash-box counter this session (may still return). */
const sessionCountedStackDenoms: BillDenom[] = [];

/** In-flight stacks — not yet credited to the counter. */
const pendingInFlightStackDenoms: BillDenom[] = [];

export function onBillStackedForCashBox(denom: BillDenom, inFlight: boolean): void {
    if (inFlight) {
        pendingInFlightStackDenoms.push(denom);
        return;
    }
    recordStackedBill(denom);
    sessionCountedStackDenoms.push(denom);
}

export function onBillReturnedForCashBox(denom: BillDenom): void {
    const pendingIdx = pendingInFlightStackDenoms.lastIndexOf(denom);
    if (pendingIdx >= 0) {
        pendingInFlightStackDenoms.splice(pendingIdx, 1);
        return;
    }

    const countedIdx = sessionCountedStackDenoms.lastIndexOf(denom);
    if (countedIdx >= 0) {
        sessionCountedStackDenoms.splice(countedIdx, 1);
        recordReturnedBill(denom);
    }
}

/** Credit pending in-flight stacks once collection is confirmed (bill stayed in box). */
export function flushPendingInFlightStacksToCounter(): void {
    for (const denom of pendingInFlightStackDenoms) {
        recordStackedBill(denom);
        sessionCountedStackDenoms.push(denom);
    }
    pendingInFlightStackDenoms.length = 0;
}

/** @internal — tests only */
export function __test__resetCashBoxStackReturn(): void {
    sessionCountedStackDenoms.length = 0;
    pendingInFlightStackDenoms.length = 0;
}

/** @internal — tests only */
export function __test__readCashBoxStackReturnState() {
    return {
        pendingInFlight: [...pendingInFlightStackDenoms],
        sessionCounted: [...sessionCountedStackDenoms],
    };
}
