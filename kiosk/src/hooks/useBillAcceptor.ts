import { computed, ref } from 'vue';
import type { PluginListenerHandle } from '@capacitor/core';
import { Hardware, type BillEvent } from 'capacitor-hardware';
import { realApi } from '../api/realApi';
import {
    auditTopupEnd,
    billsFromStackedAmounts,
    type BillsCount,
    type TopupStatus,
} from '../lib/kioskAuditLog';
import { retryTopupApi } from '../lib/topupApiRetry';
import {
    flushPendingInFlightStacksToCounter,
    isInFlightStackedBillEvent,
    onBillReturnedForCashBox,
    onBillStackedForCashBox,
} from '../lib/cashBoxStackReturn';

const PENDING_KEY = 'kiosk-pending-cash-topup';

export interface PendingCashTopup {
    walletId: string;
    amount: number;
    ts: number;
    ref: string;
    idempotencyKey: string;
    actingUserId: number | null;
    actingCustomerId: number | null;
    payer_id: string;
    receiver_id: string;
    target_amount: number;
    bills?: BillsCount;
}

export interface CashTopupContext {
    payer_id: string;
    receiver_id: string;
    target_amount: number;
    ref: string;
}

/** In-memory fallback when localStorage quota is exhausted. */
let memoryPending: PendingCashTopup | null = null;

function newSessionRef(): string {
    return crypto.randomUUID();
}

export function loadPending(): PendingCashTopup | null {
    if (memoryPending) return memoryPending;
    try {
        const raw = localStorage.getItem(PENDING_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PendingCashTopup & { idempotencyKey?: string; ref?: string };
        if (!parsed.ref && parsed.idempotencyKey) {
            parsed.ref = parsed.idempotencyKey;
        }
        if (!parsed.idempotencyKey && parsed.ref) {
            parsed.idempotencyKey = parsed.ref;
        }
        return parsed;
    } catch {
        try {
            localStorage.removeItem(PENDING_KEY);
        } catch {
            /* ignore */
        }
        return null;
    }
}

function savePending(pending: PendingCashTopup): void {
    memoryPending = pending;
    try {
        localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    } catch {
        /* API must still run — memoryPending holds the ref for retry */
    }
}

export function clearPending(): void {
    memoryPending = null;
    try {
        localStorage.removeItem(PENDING_KEY);
    } catch {
        /* ignore */
    }
}

const collecting = ref(false);
const targetThb = ref(0);
const collectedThb = ref(0);
const overpayPending = ref<BillEvent | null>(null);
const collectComplete = ref(false);
const hardwareReady = ref(false);
const lastHardwareError = ref<string | null>(null);

let cashSessionRef: string | null = null;
const stackedBillAmounts: number[] = [];
const billInFlight = ref(false);
const billActivityTick = ref(0);

let listenerHandle: PluginListenerHandle | null = null;
/** True after inhibitAccepting() — cleared when a new collecting session starts. */
let cashAcceptInhibited = false;

/** True while a bill is in escrow / stacking — do not finalize idle yet. */
export function applyBillInFlight(type: BillEvent['type'], currentlyInFlight: boolean): boolean {
    switch (type) {
        case 'escrowPending':
        case 'accepted':
        case 'overpayPending':
            return true;
        case 'stacked':
        case 'returned':
        case 'collectComplete':
            return false;
        default:
            return currentlyInFlight;
    }
}

function noteBillActivity(type: BillEvent['type']): void {
    if (
        type === 'escrowPending'
        || type === 'accepted'
        || type === 'overpayPending'
        || type === 'stacked'
        || type === 'returned'
        || type === 'exception'
        || type === 'rejected'
    ) {
        billActivityTick.value += 1;
    }
}

export function getCashSessionRef(): string | null {
    return cashSessionRef;
}

export function getStackedBillsCount(): BillsCount {
    return billsFromStackedAmounts(stackedBillAmounts);
}

export function getCashTargetAmount(): number {
    return targetThb.value;
}

function resetBillCounts(): void {
    stackedBillAmounts.length = 0;
}

function handleBillEvent(event: BillEvent) {
    noteBillActivity(event.type);
    billInFlight.value = applyBillInFlight(event.type, billInFlight.value);
    switch (event.type) {
        case 'ready':
            hardwareReady.value = true;
            break;
        case 'collecting':
            collecting.value = true;
            targetThb.value = event.targetThb ?? targetThb.value;
            collectedThb.value = event.collectedThb ?? 0;
            collectComplete.value = false;
            overpayPending.value = null;
            break;
        case 'stacked':
            if (event.billAmountThb === 100 || event.billAmountThb === 500 || event.billAmountThb === 1000) {
                stackedBillAmounts.push(event.billAmountThb);
                onBillStackedForCashBox(
                    event.billAmountThb,
                    isInFlightStackedBillEvent(event.message),
                );
            }
            collectedThb.value = event.collectedThb ?? collectedThb.value;
            overpayPending.value = null;
            break;
        case 'overpayPending':
            overpayPending.value = event;
            if (event.collectedThb != null) collectedThb.value = event.collectedThb;
            if (event.targetThb != null) targetThb.value = event.targetThb;
            break;
        case 'returned':
            if (event.billAmountThb === 100 || event.billAmountThb === 500 || event.billAmountThb === 1000) {
                const denom = event.billAmountThb;
                const stackedIdx = stackedBillAmounts.lastIndexOf(denom);
                if (stackedIdx >= 0) stackedBillAmounts.splice(stackedIdx, 1);
                onBillReturnedForCashBox(denom);
            }
            overpayPending.value = null;
            if (event.collectedThb != null) collectedThb.value = event.collectedThb;
            break;
        case 'collectComplete':
            collecting.value = false;
            collectComplete.value = true;
            flushPendingInFlightStacksToCounter();
            if (event.collectedThb != null) collectedThb.value = event.collectedThb;
            break;
        case 'error':
            lastHardwareError.value = event.message ?? 'Hardware error';
            break;
        case 'exception':
            lastHardwareError.value = event.message ?? 'Bill acceptor exception';
            break;
    }
}

async function ensureListener() {
    if (listenerHandle) return;
    listenerHandle = await Hardware.addListener('billEvent', handleBillEvent);
}

function resetSessionState() {
    collecting.value = false;
    targetThb.value = 0;
    collectedThb.value = 0;
    overpayPending.value = null;
    collectComplete.value = false;
    cashSessionRef = null;
    billInFlight.value = false;
    resetBillCounts();
}

function logTopupEnd(
    ctx: CashTopupContext,
    status: TopupStatus,
    actualAmount: number,
    opts?: { transaction_id?: number; reason?: string; retry?: boolean },
): void {
    auditTopupEnd({
        ref: ctx.ref,
        method: 'CASH',
        payer_id: ctx.payer_id,
        receiver_id: ctx.receiver_id,
        target_amount: ctx.target_amount,
        actual_amount: actualAmount,
        status,
        bills: getStackedBillsCount(),
        transaction_id: opts?.transaction_id,
        reason: opts?.reason,
        retry: opts?.retry,
    });
}

/** Retry a cash top-up that stacked bills but failed to reach the server. */
export async function retryPendingCashTopup(): Promise<boolean> {
    const pending = loadPending();
    if (!pending?.ref) return false;

    const ctx: CashTopupContext = {
        ref: pending.ref,
        payer_id: pending.payer_id,
        receiver_id: pending.receiver_id,
        target_amount: pending.target_amount,
    };

    try {
        const res = await realApi.topUp(
            pending.walletId,
            pending.amount,
            'cash',
            pending.ref,
            pending.actingUserId ?? null,
            pending.actingCustomerId ?? null,
        );
        clearPending();
        auditTopupEnd({
            ref: ctx.ref,
            method: 'CASH',
            payer_id: ctx.payer_id,
            receiver_id: ctx.receiver_id,
            target_amount: ctx.target_amount,
            actual_amount: pending.amount,
            status: 'success',
            bills: pending.bills,
            transaction_id: res.transaction_id,
            retry: true,
        });
        return true;
    } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        auditTopupEnd({
            ref: ctx.ref,
            method: 'CASH',
            payer_id: ctx.payer_id,
            receiver_id: ctx.receiver_id,
            target_amount: ctx.target_amount,
            actual_amount: pending.amount,
            status: 'failed',
            bills: pending.bills,
            reason: errMsg,
            retry: true,
        });
        return false;
    }
}

export function useBillAcceptor() {
    const remainingThb = computed(() => Math.max(0, targetThb.value - collectedThb.value));
    const canConfirm = computed(
        () => collectedThb.value > 0 && !overpayPending.value,
    );
    const isTargetMet = computed(() => collectedThb.value >= targetThb.value && targetThb.value > 0);

    async function start(target: number): Promise<string> {
        await ensureListener();
        resetSessionState();
        cashAcceptInhibited = false;
        cashSessionRef = newSessionRef();
        targetThb.value = target;
        lastHardwareError.value = null;
        await Hardware.startCollecting({ targetThb: target });
        return cashSessionRef;
    }

    async function stop() {
        try {
            await Hardware.stopCollecting();
        } catch (e) {
            console.warn('[BillAcceptor] stopCollecting failed:', e);
        }
        collecting.value = false;
        overpayPending.value = null;
        billInFlight.value = false;
    }

    /** Disable the acceptor for new bills without tearing down the cash session (idempotent). */
    async function inhibitAccepting(): Promise<void> {
        if (cashAcceptInhibited) return;
        cashAcceptInhibited = true;
        await stop();
    }

    async function acceptOverpay() {
        await Hardware.acceptBill();
        overpayPending.value = null;
    }

    async function returnOverpay() {
        await Hardware.returnBill();
        overpayPending.value = null;
    }

    async function finalizeTopUp(
        walletId: string,
        amount: number,
        actingUserId: number | null = null,
        actingCustomerId: number | null = null,
        ctx: CashTopupContext,
    ): Promise<{ transaction_id: number; balance_after: number }> {
        const ref = ctx.ref || cashSessionRef || newSessionRef();

        const pending: PendingCashTopup = {
            walletId,
            amount,
            ts: Date.now(),
            ref,
            idempotencyKey: ref,
            actingUserId,
            actingCustomerId,
            payer_id: ctx.payer_id,
            receiver_id: ctx.receiver_id,
            target_amount: ctx.target_amount,
            bills: getStackedBillsCount(),
        };
        savePending(pending);

        try {
            const res = await retryTopupApi(() =>
                realApi.topUp(walletId, amount, 'cash', ref, actingUserId, actingCustomerId),
            );
            clearPending();
            logTopupEnd(ctx, 'success', amount, { transaction_id: res.transaction_id });
            return res;
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            logTopupEnd(ctx, 'failed', amount, { reason: errMsg });
            throw e;
        }
    }

    function acknowledgeCollectComplete() {
        collectComplete.value = false;
    }

    return {
        collecting,
        targetThb,
        collectedThb,
        remainingThb,
        overpayPending,
        collectComplete,
        hardwareReady,
        lastHardwareError,
        billInFlight,
        billActivityTick,
        canConfirm,
        isTargetMet,
        start,
        stop,
        inhibitAccepting,
        acceptOverpay,
        returnOverpay,
        finalizeTopUp,
        acknowledgeCollectComplete,
        resetSessionState,
        getCashSessionRef,
        getStackedBillsCount,
        getCashTargetAmount,
    };
}

/** @deprecated use session payer from store — kept for import compatibility */
export function setBillSessionMember(_memberLogId: string | null): void {
    /* no-op — audit logs use payer_id / receiver_id */
}

/** Credit in-flight escrow stacks once collection is confirmed. */
export function flushPendingCashBoxStacks(): void {
    flushPendingInFlightStacksToCounter();
}

export function __test__resetBillAcceptorState(): void {
    resetSessionState();
    cashAcceptInhibited = false;
    billActivityTick.value = 0;
    lastHardwareError.value = null;
    hardwareReady.value = false;
}

export function __test__dispatchBillEvent(event: BillEvent): void {
    handleBillEvent(event);
}

export function __test__readBillAcceptorState() {
    return {
        collecting: collecting.value,
        targetThb: targetThb.value,
        collectedThb: collectedThb.value,
        billInFlight: billInFlight.value,
        billActivityTick: billActivityTick.value,
        collectComplete: collectComplete.value,
        overpayPending: overpayPending.value,
        stackedBills: getStackedBillsCount(),
    };
}
