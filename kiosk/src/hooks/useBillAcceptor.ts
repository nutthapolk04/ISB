import { computed, ref } from 'vue';
import type { PluginListenerHandle } from '@capacitor/core';
import { Hardware, type BillEvent } from 'capacitor-hardware';
import { realApi } from '../api/realApi';
import { logKioskEvent } from '../lib/kioskLog';
import { formatThbAmount, techLogAtKiosk } from '../lib/techLogMessage';

const PENDING_KEY = 'kiosk-pending-cash-topup';

interface PendingCashTopup {
    walletId: string;
    amount: number;
    ts: number;
    idempotencyKey: string;
    actingUserId: number | null;
    actingCustomerId: number | null;
    memberLogId?: string;
    memberName?: string;
}

export interface CashTopupLogContext {
    memberLogId: string;
    memberName?: string;
}

/** In-memory fallback when localStorage quota is exhausted. */
let memoryPending: PendingCashTopup | null = null;

function newIdempotencyKey(): string {
    return crypto.randomUUID();
}

function loadPending(): PendingCashTopup | null {
    if (memoryPending) return memoryPending;
    try {
        const raw = localStorage.getItem(PENDING_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as PendingCashTopup;
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
        /* API must still run — memoryPending holds the idempotency key for retry */
    }
}

function clearPending(): void {
    memoryPending = null;
    try {
        localStorage.removeItem(PENDING_KEY);
    } catch {
        /* ignore */
    }
}

function pendingLogData(pending: PendingCashTopup): Record<string, unknown> {
    return {
        external_id: pending.memberLogId ?? '',
        member_name: pending.memberName ?? '',
        wallet_id: pending.walletId,
        amount: pending.amount,
        idempotency_key: pending.idempotencyKey,
    };
}

const collecting = ref(false);
const targetThb = ref(0);
const collectedThb = ref(0);
const overpayPending = ref<BillEvent | null>(null);
const collectComplete = ref(false);
const hardwareReady = ref(false);
const lastHardwareError = ref<string | null>(null);

let listenerHandle: PluginListenerHandle | null = null;

/** Member id for the active cash top-up session — set from TopUpView. */
let billSessionMemberLogId: string | null = null;

export function setBillSessionMember(memberLogId: string | null): void {
    const trimmed = memberLogId?.trim();
    billSessionMemberLogId = trimmed && trimmed !== '—' ? trimmed : null;
}

function billMemberId(): string | null {
    return billSessionMemberLogId;
}

function billLogData(event: BillEvent): Record<string, unknown> {
    return {
        external_id: billSessionMemberLogId ?? '',
        bill_amount_thb: event.billAmountThb ?? null,
        collected_thb: event.collectedThb ?? null,
        target_thb: event.targetThb ?? null,
        event_type: event.type,
        hardware_message: event.message ?? null,
    };
}

/** Log only bill events useful for cash verification (skip escrow/accepted noise). */
function logBillEventIfNeeded(event: BillEvent): void {
    const memberId = billMemberId();
    let message: string | null = null;
    let level: 'info' | 'warn' | 'error' = 'info';

    switch (event.type) {
        case 'stacked': {
            const bill = event.billAmountThb != null ? formatThbAmount(event.billAmountThb) : '?';
            const total = event.collectedThb != null ? formatThbAmount(event.collectedThb) : '?';
            message = techLogAtKiosk(
                `${bill} THB bill accepted — inserted total ${total} THB`,
                memberId,
            );
            break;
        }
        case 'overpayPending': {
            const bill = event.billAmountThb != null ? formatThbAmount(event.billAmountThb) : '?';
            const collected = event.collectedThb != null ? formatThbAmount(event.collectedThb) : '0';
            message = techLogAtKiosk(
                `${bill} THB bill held — would exceed target (inserted ${collected} THB so far)`,
                memberId,
            );
            level = 'warn';
            break;
        }
        case 'collectComplete': {
            const total = event.collectedThb != null ? formatThbAmount(event.collectedThb) : '?';
            message = techLogAtKiosk(
                `Cash collection complete — ${total} THB inserted`,
                memberId,
            );
            break;
        }
        case 'returned': {
            const bill = event.billAmountThb != null ? formatThbAmount(event.billAmountThb) : '?';
            message = techLogAtKiosk(`${bill} THB bill returned`, memberId);
            break;
        }
        case 'rejected': {
            message = techLogAtKiosk(`Bill rejected — ${event.message ?? 'unknown reason'}`, memberId);
            level = 'warn';
            break;
        }
        case 'error':
        case 'exception':
            message = techLogAtKiosk(`Cash acceptor error — ${event.message ?? event.type}`, memberId);
            level = 'error';
            break;
        default:
            return;
    }

    logKioskEvent('bill', level, message, billLogData(event));
}

function handleBillEvent(event: BillEvent) {
    logBillEventIfNeeded(event);

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
            collectedThb.value = event.collectedThb ?? collectedThb.value;
            overpayPending.value = null;
            break;
        case 'overpayPending':
            overpayPending.value = event;
            if (event.collectedThb != null) collectedThb.value = event.collectedThb;
            if (event.targetThb != null) targetThb.value = event.targetThb;
            break;
        case 'returned':
            overpayPending.value = null;
            if (event.collectedThb != null) collectedThb.value = event.collectedThb;
            break;
        case 'collectComplete':
            collecting.value = false;
            collectComplete.value = true;
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
}

/** Retry a cash top-up that stacked bills but failed to reach the server. */
export async function retryPendingCashTopup(): Promise<boolean> {
    const pending = loadPending();
    if (!pending) return false;

    const memberId = pending.memberLogId ?? '—';
    logKioskEvent('pending', 'warn', techLogAtKiosk(
        `Retrying pending cash top-up ${pending.amount} THB for user ${memberId}`,
        memberId,
    ), pendingLogData(pending));

    if (!pending.idempotencyKey) {
        clearPending();
        return false;
    }

    try {
        await realApi.topUp(
            pending.walletId,
            pending.amount,
            'cash',
            pending.idempotencyKey,
            pending.actingUserId ?? null,
            pending.actingCustomerId ?? null,
        );
        clearPending();
        logKioskEvent('pending', 'info', techLogAtKiosk(
            `Pending cash top-up ${pending.amount} THB credited for user ${memberId}`,
            memberId,
        ), pendingLogData(pending));
        return true;
    } catch (e) {
        logKioskEvent('pending', 'error', techLogAtKiosk(
            `Pending cash top-up ${pending.amount} THB failed for user ${memberId}`,
            memberId,
        ), {
            ...pendingLogData(pending),
            error: e instanceof Error ? e.message : String(e),
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

    async function start(target: number) {
        await ensureListener();
        resetSessionState();
        targetThb.value = target;
        lastHardwareError.value = null;
        await Hardware.startCollecting({ targetThb: target });
    }

    async function stop() {
        if (collecting.value) {
            await Hardware.stopCollecting();
        }
        collecting.value = false;
        overpayPending.value = null;
        setBillSessionMember(null);
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
        logContext?: CashTopupLogContext,
    ): Promise<{ transaction_id: number; balance_after: number }> {
        const existing = loadPending();
        let idempotencyKey = newIdempotencyKey();
        if (
            existing &&
            existing.walletId === walletId &&
            existing.amount === amount &&
            existing.idempotencyKey
        ) {
            idempotencyKey = existing.idempotencyKey;
        }

        const memberId = logContext?.memberLogId ?? existing?.memberLogId ?? '—';
        const memberName = logContext?.memberName ?? existing?.memberName;

        const pending: PendingCashTopup = {
            walletId,
            amount,
            ts: Date.now(),
            idempotencyKey,
            actingUserId,
            actingCustomerId,
            memberLogId: memberId === '—' ? undefined : memberId,
            memberName,
        };
        savePending(pending);
        logKioskEvent('pending', 'warn', techLogAtKiosk(
            `Cash top-up ${formatThbAmount(amount)} THB queued for user ${memberId} — calling server`,
            memberId,
        ), pendingLogData(pending));

        try {
            const res = await realApi.topUp(walletId, amount, 'cash', idempotencyKey, actingUserId, actingCustomerId);
            clearPending();
            logKioskEvent('cash', 'info', techLogAtKiosk(
                `Cash top-up ${formatThbAmount(amount)} THB succeeded for user ${memberId} (txn ${res.transaction_id})`,
                memberId,
            ), {
                ...pendingLogData(pending),
                transaction_id: res.transaction_id,
                balance_after: res.balance_after,
            });
            return res;
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            logKioskEvent('cash', 'error', techLogAtKiosk(
                `Cash top-up ${formatThbAmount(amount)} THB failed for user ${memberId} — ${errMsg}`,
                memberId,
            ), {
                ...pendingLogData(pending),
                error: errMsg,
            });
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
        canConfirm,
        isTargetMet,
        start,
        stop,
        acceptOverpay,
        returnOverpay,
        finalizeTopUp,
        acknowledgeCollectComplete,
        resetSessionState,
    };
}
