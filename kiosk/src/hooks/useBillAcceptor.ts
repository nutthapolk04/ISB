import { computed, ref } from 'vue';
import type { PluginListenerHandle } from '@capacitor/core';
import { Hardware, type BillEvent } from 'capacitor-hardware';
import { realApi } from '../api/realApi';

const PENDING_KEY = 'kiosk-pending-cash-topup';

interface PendingCashTopup {
    walletId: string;
    amount: number;
    ts: number;
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
    console.log('[BillAcceptor]', event);

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
        return false;
    }

    try {
        await realApi.topUp(pending.walletId, pending.amount, 'cash');
        localStorage.removeItem(PENDING_KEY);
        console.log('[BillAcceptor] retried pending top-up OK:', pending.amount);
        return true;
    } catch (e) {
        console.warn('[BillAcceptor] pending top-up retry failed:', e);
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
     */
    async function finalizeTopUp(walletId: string, amount: number): Promise<void> {
        const pending: PendingCashTopup = { walletId, amount, ts: Date.now() };
        localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
        try {
            await realApi.topUp(walletId, amount, 'cash');
            localStorage.removeItem(PENDING_KEY);
        } catch (e) {
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
