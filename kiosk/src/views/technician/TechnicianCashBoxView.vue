<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { AlertTriangle, Banknote, Printer } from 'lucide-vue-next';
import { formatAuditTimestamp } from '../../lib/kioskAuditLog';
import {
    buildCashBoxReportData,
    buildCashBoxSlipRows,
} from '../../lib/cashBoxReport';
import {
    buildCashBoxClearSnapshot,
    commitCashBoxClear,
    getCashBoxTotal,
    useCashBoxState,
} from '../../lib/kioskCashBox';
import { useTechnicianI18n } from '../../lib/technicianI18n';
import { usePrinter } from '../../hooks/usePrinter';
import { useKioskStore } from '../../stores/kioskStore';
import type { CashBoxClearSnapshot } from '../../lib/kioskCashBox';

const SLIP_IDLE_MS = 15_000;

const store = useKioskStore();
const t = useTechnicianI18n();
const printer = usePrinter();
const cashBox = useCashBoxState();

const showConfirm = ref(false);
const showSlip = ref(false);
const slipSnapshot = ref<CashBoxClearSnapshot | null>(null);
const slipPrintFailed = ref(false);
const slipCommitOnClose = ref(false);
const slipSecondsLeft = ref(0);
const printing = ref(false);
const clearing = ref(false);

let slipTimer: number | null = null;
let slipTick: number | null = null;

const total = computed(() => getCashBoxTotal(cashBox.value.counts));
const hasBills = computed(() => total.value > 0);

const lastClearedLabel = computed(() => {
    if (!cashBox.value.lastClearedAt) return t.value.neverCleared;
    return formatAuditTimestamp(new Date(cashBox.value.lastClearedAt));
});

const reportLabels = computed(() => ({
    title: t.value.reportTitle,
    typeLabel: t.value.reportType,
    device: t.value.reportDevice,
    dateTime: t.value.reportDateTime,
    bill100: t.value.bill100,
    bill500: t.value.bill500,
    bill1000: t.value.bill1000,
    countUnit: t.value.countUnit,
    total: t.value.cashBoxTotal,
    sinceClear: t.value.reportSinceClear,
    footer: t.value.reportFooter,
}));

function formatSinceClear(iso: string): string {
    return formatAuditTimestamp(new Date(iso));
}

function buildReportInput(snapshot: CashBoxClearSnapshot) {
    return {
        bills: snapshot.bills,
        deviceName: store.deviceProfile?.full_name,
        lastClearedAt: cashBox.value.lastClearedAt,
        clearedAt: snapshot.clearedAt,
        labels: reportLabels.value,
        formatSinceClear,
    };
}

async function printSnapshot(snapshot: CashBoxClearSnapshot): Promise<boolean> {
    printing.value = true;
    try {
        await printer.printReceipt(buildCashBoxReportData(buildReportInput(snapshot)));
        return true;
    } catch (e) {
        console.warn('[CashBox] print failed:', e);
        return false;
    } finally {
        printing.value = false;
    }
}

function clearSlipTimers() {
    if (slipTimer != null) {
        clearTimeout(slipTimer);
        slipTimer = null;
    }
    if (slipTick != null) {
        clearInterval(slipTick);
        slipTick = null;
    }
    slipSecondsLeft.value = 0;
}

function closeSlip() {
    if (!slipSnapshot.value) return;
    const shouldCommit = slipCommitOnClose.value;
    const snapshot = slipSnapshot.value;
    clearSlipTimers();
    showSlip.value = false;
    slipPrintFailed.value = false;
    slipCommitOnClose.value = false;
    slipSnapshot.value = null;
    if (shouldCommit && !clearing.value) {
        clearing.value = true;
        commitCashBoxClear(snapshot);
        clearing.value = false;
    }
}

function openSlip(snapshot: CashBoxClearSnapshot, printFailed: boolean, commitOnClose: boolean) {
    slipSnapshot.value = snapshot;
    slipPrintFailed.value = printFailed;
    slipCommitOnClose.value = commitOnClose;
    showSlip.value = true;
    slipSecondsLeft.value = Math.ceil(SLIP_IDLE_MS / 1000);
    slipTick = window.setInterval(() => {
        slipSecondsLeft.value = Math.max(0, slipSecondsLeft.value - 1);
    }, 1000);
    slipTimer = window.setTimeout(() => {
        closeSlip();
    }, SLIP_IDLE_MS);
}

async function runClearFlow() {
    if (!hasBills.value || clearing.value) return;
    showConfirm.value = false;
    clearing.value = true;
    const snapshot = buildCashBoxClearSnapshot();
    const printed = await printSnapshot(snapshot);
    if (printed) {
        commitCashBoxClear(snapshot);
    } else {
        openSlip(snapshot, true, true);
    }
    clearing.value = false;
}

function requestClear() {
    if (!hasBills.value) return;
    showConfirm.value = true;
}

async function printReportOnly() {
    if (!hasBills.value || printing.value) return;
    const snapshot = buildCashBoxClearSnapshot();
    const printed = await printSnapshot(snapshot);
    if (!printed) {
        openSlip(snapshot, true, false);
    }
}

const slipRows = computed(() => {
    if (!slipSnapshot.value) return [];
    return buildCashBoxSlipRows(slipSnapshot.value.bills, {
        bill100: t.value.bill100,
        bill500: t.value.bill500,
        bill1000: t.value.bill1000,
        countUnit: t.value.countUnit,
    });
});

onUnmounted(() => {
    clearSlipTimers();
});
</script>

<template>
    <div class="tech-stack cashbox-page panel-scroll">
        <section class="panel-card">
            <div class="panel-title-row">
                <Banknote :size="16" class="panel-title-icon" />
                <h2 class="panel-title">{{ t.cashBoxTitle }}</h2>
            </div>
            <p class="cashbox-intro">{{ t.cashBoxSubtitle }}</p>

            <div class="cashbox-grid" style="margin-top: 1rem;">
                <div class="cashbox-tile tone-brown">
                    <div class="cashbox-denom">{{ t.bill1000 }}</div>
                    <div class="cashbox-count">{{ cashBox.counts[1000] ?? 0 }}</div>
                    <div class="cashbox-unit">{{ t.countUnit }}</div>
                </div>
                <div class="cashbox-tile tone-purple">
                    <div class="cashbox-denom">{{ t.bill500 }}</div>
                    <div class="cashbox-count">{{ cashBox.counts[500] ?? 0 }}</div>
                    <div class="cashbox-unit">{{ t.countUnit }}</div>
                </div>
                <div class="cashbox-tile tone-orange">
                    <div class="cashbox-denom">{{ t.bill100 }}</div>
                    <div class="cashbox-count">{{ cashBox.counts[100] ?? 0 }}</div>
                    <div class="cashbox-unit">{{ t.countUnit }}</div>
                </div>
            </div>

            <div class="cashbox-total-card" style="margin-top: 1rem;">
                <span class="cashbox-total-label">{{ t.cashBoxTotal }}</span>
                <span class="cashbox-total-value">฿{{ total.toLocaleString('en-US') }}</span>
            </div>

            <p class="cashbox-meta" style="margin-top: 0.75rem;">
                {{ t.lastCleared }}: {{ lastClearedLabel }}
            </p>

            <div class="cashbox-actions" style="margin-top: 1.25rem;">
                <button class="btn-outline" type="button" :disabled="!hasBills || printing || clearing" @click="printReportOnly">
                    <Printer :size="16" />
                    {{ printing ? t.printing : t.printReport }}
                </button>
                <button class="btn-outline btn-outline-danger" type="button" :disabled="!hasBills || printing || clearing" @click="requestClear">
                    {{ t.clearCashBox }}
                </button>
            </div>
            <p v-if="!hasBills" class="cashbox-meta" style="margin-top: 0.75rem;">{{ t.clearEmpty }}</p>
        </section>
    </div>

    <div v-if="showConfirm" class="cashbox-confirm-overlay" @click.self="showConfirm = false">
        <div class="cashbox-confirm-card">
            <h3 class="cashbox-confirm-title">{{ t.clearConfirmTitle }}</h3>
            <p class="cashbox-confirm-desc">{{ t.clearConfirmDesc }}</p>
            <div class="cashbox-confirm-actions">
                <button class="btn-outline" type="button" @click="showConfirm = false">{{ t.clearCancelBtn }}</button>
                <button class="btn-primary" type="button" @click="runClearFlow">{{ t.clearConfirmBtn }}</button>
            </div>
        </div>
    </div>

    <div v-if="showSlip && slipSnapshot" class="cashbox-slip-overlay">
        <div class="cashbox-slip-card">
            <h3 class="cashbox-slip-title">{{ t.slipTitle }}</h3>
            <p v-if="slipPrintFailed" class="cashbox-slip-warn">
                <AlertTriangle :size="16" style="vertical-align: -2px;" />
                {{ t.slipPrintFailed }}
            </p>
            <p class="cashbox-meta">{{ store.deviceProfile?.full_name }}</p>
            <p class="cashbox-meta">{{ formatAuditTimestamp(new Date(slipSnapshot.clearedAt)) }}</p>

            <div
                v-for="row in slipRows"
                :key="row.label"
                class="cashbox-slip-row"
                :class="row.tone ? `tone-${row.tone}` : ''"
            >
                <span class="cashbox-slip-label">{{ row.label }}</span>
                <span class="cashbox-slip-value">{{ row.value }}</span>
            </div>

            <div class="cashbox-slip-total">
                <span>{{ t.cashBoxTotal }}</span>
                <span>฿{{ slipSnapshot.amount.toLocaleString('en-US') }}</span>
            </div>

            <p class="cashbox-slip-hint">
                {{ slipSecondsLeft > 0 ? t.slipAutoClose.replace('{n}', String(slipSecondsLeft)) : '' }}
            </p>
            <button class="btn-primary-full" type="button" style="margin-top: 1rem;" @click="closeSlip">
                {{ t.slipClose }}
            </button>
        </div>
    </div>
</template>

<style scoped src="../../styles/technician.css"></style>
