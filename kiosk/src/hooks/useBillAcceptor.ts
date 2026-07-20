import { computed, ref } from 'vue';
import type { PluginListenerHandle } from '@capacitor/core';
import { Hardware, type BillEvent } from 'capacitor-hardware';
import { realApi } from '../api/realApi';
import { logKioskEvent } from '../lib/kioskLog';

const PENDING_KEY = 'kiosk-pending-cash-topup';

interface PendingCashTopup {
    walletId: string;
    amount: number;
    ts: number;
    idempotencyKey: string;
    actingUserId: number | null;
    actingCustomerId: number | null;
}

function newIdempotencyKey(): string {
    return crypto.randomUUID();
}

const collecting = ref(false);
const targetThb = ref(0);
const collectedThb = ref(0);
const overpayPending = ref<BillEvent | null>(null);
const collectComplete = ref(false);
const hardwareReady = ref(false);
const lastHardwareError = ref<string | null>(null);

let listenerHandle: PluginListenerHandle | null = null;

function handleBillEvent(event: BillEvent) {
    logKioskEvent('bill', event.type === 'error' || event.type === 'exception' ? 'error' : 'info', `bill:${event.type}`, {
        targetThb: event.targetThb,
        collectedThb: event.collectedThb,
        message: event.message,
    });

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
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return false;

    let pending: PendingCashTopup;
    try {
        pending = JSON.parse(raw) as PendingCashTopup;
    } catch {
        localStorage.removeItem(PENDING_KEY);
        logKioskEvent('pending', 'error', 'Corrupt pending top-up removed');
        return false;
    }

    logKioskEvent('pending', 'warn', 'Retrying pending cash top-up', { ...pending });

    if (!pending.idempotencyKey) {
        localStorage.removeItem(PENDING_KEY);
        return false;
    }

    try {
        await realApi.topUp(pending.walletId, pending.amount, 'cash', pending.idempotencyKey, pending.actingUserId ?? null, pending.actingCustomerId ?? null);
        localStorage.removeItem(PENDING_KEY);
        logKioskEvent('pending', 'info', 'Pending cash top-up retry succeeded', { amount: pending.amount });
        return true;
    } catch (e) {
        logKioskEvent('pending', 'error', 'Pending cash top-up retry failed', {
            amount: pending.amount,
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
    }

    async function acceptOverpay() {
        await Hardware.acceptBill();
        overpayPending.value = null;
    }

    async function returnOverpay() {
        await Hardware.returnBill();
        overpayPending.value = null;
    }

    /**
     * Credit the wallet for cash already stacked in the acceptor.
     * Persists to localStorage before the API call so a network failure can be retried.
     * Returns the new transaction id and post-top-up balance so the caller can print a receipt.
     */
    async function finalizeTopUp(
        walletId: string,
        amount: number,
        actingUserId: number | null = null,
        actingCustomerId: number | null = null,
    ): Promise<{ transaction_id: number; balance_after: number }> {
        const existingRaw = localStorage.getItem(PENDING_KEY);
        let idempotencyKey = newIdempotencyKey();
        if (existingRaw) {
            try {
                const existing = JSON.parse(existingRaw) as PendingCashTopup;
                if (
                    existing.walletId === walletId &&
                    existing.amount === amount &&
                    existing.idempotencyKey
                ) {
                    idempotencyKey = existing.idempotencyKey;
                }
            } catch {
                /* use fresh key */
            }
        }

        const pending: PendingCashTopup = {
            walletId,
            amount,
            ts: Date.now(),
            idempotencyKey,
            actingUserId,
            actingCustomerId,
        };
        localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
        logKioskEvent('pending', 'warn', 'Pending cash top-up saved before API', { ...pending });
        try {
            const res = await realApi.topUp(walletId, amount, 'cash', idempotencyKey, actingUserId, actingCustomerId);
            localStorage.removeItem(PENDING_KEY);
            logKioskEvent('cash', 'info', 'Cash top-up API succeeded', {
                walletId,
                amount,
                transaction_id: res.transaction_id,
                idempotencyKey,
            });
            return res;
        } catch (e) {
            logKioskEvent('cash', 'error', 'Cash top-up API failed — pending retained in storage', {
                walletId,
                amount,
                idempotencyKey,
                error: e instanceof Error ? e.message : String(e),
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
