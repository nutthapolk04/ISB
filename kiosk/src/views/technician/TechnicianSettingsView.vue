<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import {
    Activity,
    AlertTriangle,
    Bug,
    CheckCircle2,
    Download,
    MapPin,
    RefreshCw,
    Save,
    Shield,
} from 'lucide-vue-next';
import { useKioskStore } from '../../stores/kioskStore';
import { useKioskDebugMode } from '../../lib/debugMode';
import { checkKioskUpdate, type KioskUpdateCheck } from '../../lib/kioskRelease';
import { getKioskLogStorageStats } from '../../lib/kioskLog';
import { useTechnicianI18n } from '../../lib/technicianI18n';
import { Hardware, type PollStatusResult } from 'capacitor-hardware';

const store = useKioskStore();
const t = useTechnicianI18n();
const debugMode = useKioskDebugMode();

const locationInput = ref('');
const savingLocation = ref(false);
const saveMessage = ref('');
const stats = ref({ days: 0, retainDays: 90, estimatedMb: 0 });

const billPollLoading = ref(false);
const billPollResult = ref<PollStatusResult | null>(null);
const billPollError = ref('');

const updateCheck = ref<KioskUpdateCheck | null>(null);
const updateLoading = ref(false);
const updateError = ref('');
const updateInstallMessage = ref('');

const firmwareLabel = computed(() => `v${__APP_VERSION__} · build ${__BUILD_TIME__}`);

const billPollStatusLabel = computed(() => {
    const r = billPollResult.value;
    if (!r) return '';
    const labels: Record<string, string> = {
        enabled: t.value.billPollEnabled,
        inhibited: t.value.billPollInhibited,
        error: t.value.billPollError,
        timeout: t.value.billPollTimeout,
        unknown: r.statusHex || '—',
    };
    return labels[r.status] ?? r.status;
});

onMounted(async () => {
    locationInput.value = store.deviceProfile?.full_name ?? '';
    stats.value = await getKioskLogStorageStats();
    if (Capacitor.getPlatform() === 'android') {
        void refreshUpdateCheck();
    }
});

async function refreshUpdateCheck() {
    if (Capacitor.getPlatform() !== 'android') return;
    updateLoading.value = true;
    updateError.value = '';
    updateInstallMessage.value = '';
    try {
        updateCheck.value = await checkKioskUpdate(() => App.getInfo());
    } catch (e) {
        updateCheck.value = null;
        updateError.value = e instanceof Error ? e.message : t.value.updateCheckFailed;
    } finally {
        updateLoading.value = false;
    }
}

async function installLatest() {
    const url = updateCheck.value?.downloadUrl;
    if (!url) {
        updateError.value = t.value.updateNoDownload;
        return;
    }
    updateInstallMessage.value = '';
    try {
        await Browser.open({ url });
        updateInstallMessage.value = t.value.updateOpened;
    } catch (e) {
        updateError.value = e instanceof Error ? e.message : t.value.updateCheckFailed;
    }
}

async function saveLocation() {
    const name = locationInput.value.trim();
    if (!name) return;
    savingLocation.value = true;
    saveMessage.value = '';
    try {
        await store.updateDeviceLocation(name);
        saveMessage.value = t.value.saved;
        setTimeout(() => { saveMessage.value = ''; }, 2000);
    } catch (e) {
        saveMessage.value = e instanceof Error ? e.message : 'Save failed';
    } finally {
        savingLocation.value = false;
    }
}

function toggleDebugMode() {
    debugMode.value = !debugMode.value;
}

async function runBillPoll() {
    if (billPollLoading.value) return;
    billPollLoading.value = true;
    billPollError.value = '';
    billPollResult.value = null;
    try {
        billPollResult.value = await Hardware.pollStatus();
    } catch (e) {
        billPollError.value = e instanceof Error ? e.message : t.value.billPollFailed;
    } finally {
        billPollLoading.value = false;
    }
}
</script>

<template>
    <div class="tech-stack panel-scroll">
        <section class="panel-card">
            <div class="panel-title-row">
                <Shield :size="16" class="panel-title-icon" />
                <h2 class="panel-title">{{ t.deviceAccount }}</h2>
            </div>

            <dl class="field-grid">
                <div>
                    <dt class="field-dt">{{ t.deviceId }}</dt>
                    <dd class="field-dd mono">{{ store.deviceProfile?.username ?? '—' }}</dd>
                </div>
                <div>
                    <dt class="field-dt">{{ t.firmware }}</dt>
                    <dd class="field-dd mono">{{ firmwareLabel }}</dd>
                </div>
            </dl>

            <div v-if="Capacitor.getPlatform() === 'android'" class="update-block">
                <div class="update-header">
                    <div>
                        <div class="field-label with-icon">
                            <Download :size="14" />
                            {{ t.appUpdate }}
                        </div>
                        <p class="update-hint">{{ t.appUpdateHint }}</p>
                    </div>
                    <button class="btn-ghost-sm" type="button" :disabled="updateLoading" @click="refreshUpdateCheck">
                        <RefreshCw :size="14" :class="{ spin: updateLoading }" />
                        {{ t.recheckUpdate }}
                    </button>
                </div>

                <p v-if="updateLoading" class="update-line muted">{{ t.checkingUpdate }}</p>
                <p v-else-if="updateError" class="error-line">
                    <AlertTriangle :size="14" />
                    {{ updateError }}
                </p>
                <template v-else-if="updateCheck">
                    <p class="update-line" :class="updateCheck.updateAvailable ? 'update-pending' : 'update-ok'">
                        <CheckCircle2 v-if="!updateCheck.updateAvailable" :size="14" />
                        <AlertTriangle v-else :size="14" />
                        {{
                            updateCheck.updateAvailable
                                ? t.updateAvailable(updateCheck.latestVersionName)
                                : t.upToDate
                        }}
                    </p>
                    <button
                        v-if="updateCheck.updateAvailable"
                        class="btn-primary update-install-btn"
                        type="button"
                        :disabled="!updateCheck.downloadUrl"
                        @click="installLatest"
                    >
                        <Download :size="16" />
                        {{ t.installLatest }}
                    </button>
                </template>
                <p v-if="updateInstallMessage" class="success-line">
                    <CheckCircle2 :size="14" />
                    {{ updateInstallMessage }}
                </p>
            </div>

            <div class="location-block">
                <label class="field-label with-icon">
                    <MapPin :size="14" />
                    {{ t.location }}
                </label>
                <div class="location-row">
                    <input v-model="locationInput" class="tech-input" type="text" maxlength="255" />
                    <button class="btn-primary" type="button" :disabled="savingLocation" @click="saveLocation">
                        <Save :size="16" />
                        {{ savingLocation ? t.saving : t.save }}
                    </button>
                </div>
                <p v-if="saveMessage" class="success-line">
                    <CheckCircle2 :size="14" />
                    {{ saveMessage }}
                </p>
            </div>

            <div class="debug-block">
                <div class="debug-row">
                    <div class="debug-copy">
                        <div class="field-label with-icon debug-label">
                            <Bug :size="14" />
                            {{ t.debugMode }}
                            <span class="debug-state" :class="debugMode ? 'is-on' : 'is-off'">
                                {{ debugMode ? t.debugOn : t.debugOff }}
                            </span>
                        </div>
                        <p class="debug-hint">{{ t.debugModeHint }}</p>
                    </div>
                    <button
                        class="debug-switch"
                        type="button"
                        role="switch"
                        :aria-checked="debugMode"
                        :class="{ 'is-on': debugMode }"
                        @click="toggleDebugMode"
                    >
                        <span class="debug-knob" />
                    </button>
                </div>
            </div>

            <div class="debug-block bill-poll-block">
                <div class="debug-copy">
                    <div class="field-label with-icon debug-label">
                        <Activity :size="14" />
                        {{ t.billAcceptor }}
                    </div>
                    <p class="debug-hint">{{ t.billPollHint }}</p>
                </div>
                <button class="btn-outline bill-poll-btn" type="button" :disabled="billPollLoading" @click="runBillPoll">
                    {{ billPollLoading ? t.billPolling : t.billPoll }}
                </button>
                <p v-if="billPollResult" class="bill-poll-result" :class="`is-${billPollResult.status}`">
                    <span class="bill-poll-status">{{ billPollStatusLabel }}</span>
                    <span v-if="billPollResult.statusHex" class="bill-poll-hex mono">0x{{ billPollResult.statusHex }}</span>
                    <span v-if="billPollResult.message" class="bill-poll-msg">{{ billPollResult.message }}</span>
                </p>
                <p v-if="billPollError" class="error-line">
                    <AlertTriangle :size="14" />
                    {{ billPollError }}
                </p>
            </div>

            <p class="retention-line">
                {{ t.retention }}: <span>{{ stats.retainDays }} {{ t.days }}</span> ·
                {{ t.storageUsed }}: <span>{{ stats.estimatedMb }} MB</span>
            </p>
        </section>
    </div>
</template>

<style scoped src="../../styles/technician.css"></style>
