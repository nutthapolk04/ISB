<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, Lock, Unlock, Save, Copy, Wrench } from 'lucide-vue-next';
import { useKioskStore } from '../stores/kioskStore';
import { realApi } from '../api/realApi';
import {
    exportKioskLogsText,
    getKioskLogStorageStats,
    getKioskLogsForDay,
    listKioskLogDays,
    logKioskEvent,
    type KioskLogCategory,
    type KioskLogEntry,
} from '../lib/kioskLog';

const router = useRouter();
const store = useKioskStore();

const unlocked = ref(false);
const password = ref('');
const unlockError = ref('');
const locationInput = ref('');
const savingLocation = ref(false);
const saveMessage = ref('');
const copyMessage = ref('');

const selectedDay = ref('');
const categoryFilter = ref<KioskLogCategory | 'all'>('all');

const stats = computed(() => getKioskLogStorageStats());
const days = computed(() => listKioskLogDays());

const entries = computed((): KioskLogEntry[] => {
    const day = selectedDay.value || days.value[0] || new Date().toISOString().slice(0, 10);
    const list = getKioskLogsForDay(day);
    if (categoryFilter.value === 'all') return list;
    return list.filter((e) => e.category === categoryFilter.value);
});

const t = computed(() => ({
    EN: {
        title: 'Technician',
        locked: 'Enter device password to view logs',
        password: 'Device password',
        unlock: 'Unlock',
        wrongPassword: 'Incorrect password',
        location: 'Installation location',
        save: 'Save location',
        saved: 'Location saved',
        device: 'Device account',
        logs: 'Event log',
        day: 'Day',
        category: 'Category',
        all: 'All',
        export: 'Copy log text',
        copied: 'Copied to clipboard',
        back: 'Back',
        retain: 'Retention',
        days: 'days',
        maxDay: 'Max per day',
        empty: 'No log entries for this day',
    },
    TH: {
        title: 'ผู้ดูแลเครื่อง',
        locked: 'ใส่รหัสผ่านเครื่องเพื่อดู log',
        password: 'รหัสผ่านเครื่อง',
        unlock: 'ปลดล็อก',
        wrongPassword: 'รหัสผ่านไม่ถูกต้อง',
        location: 'จุดติดตั้ง',
        save: 'บันทึกชื่อจุด',
        saved: 'บันทึกแล้ว',
        device: 'บัญชีเครื่อง',
        logs: 'บันทึกเหตุการณ์',
        day: 'วันที่',
        category: 'หมวด',
        all: 'ทั้งหมด',
        export: 'คัดลอก log',
        copied: 'คัดลอกแล้ว',
        back: 'กลับ',
        retain: 'เก็บย้อนหลัง',
        days: 'วัน',
        maxDay: 'สูงสุดต่อวัน',
        empty: 'ไม่มี log ในวันนี้',
    },
}[store.language]));

const categories: Array<KioskLogCategory | 'all'> = [
    'all', 'system', 'auth', 'api', 'bill', 'cash', 'qr', 'pending',
];

onMounted(() => {
    selectedDay.value = days.value[0] ?? new Date().toISOString().slice(0, 10);
    locationInput.value = store.deviceProfile?.full_name ?? '';
    logKioskEvent('system', 'info', 'Technician screen opened');
});

function tryUnlock() {
    unlockError.value = '';
    if (realApi.verifyTechnicianPassword(password.value)) {
        unlocked.value = true;
        password.value = '';
        logKioskEvent('system', 'info', 'Technician unlocked');
        return;
    }
    unlockError.value = t.value.wrongPassword;
    logKioskEvent('system', 'warn', 'Technician unlock failed');
}

async function saveLocation() {
    const name = locationInput.value.trim();
    if (!name) return;
    savingLocation.value = true;
    saveMessage.value = '';
    try {
        await store.updateDeviceLocation(name);
        saveMessage.value = t.value.saved;
    } catch (e) {
        saveMessage.value = e instanceof Error ? e.message : 'Save failed';
    } finally {
        savingLocation.value = false;
    }
}

async function copyLogs() {
    const text = exportKioskLogsText(selectedDay.value || undefined);
    try {
        await navigator.clipboard.writeText(text);
        copyMessage.value = t.value.copied;
        setTimeout(() => { copyMessage.value = ''; }, 2000);
        logKioskEvent('system', 'info', 'Technician exported logs', { day: selectedDay.value });
    } catch {
        copyMessage.value = 'Copy failed';
    }
}

function levelClass(level: string): string {
    if (level === 'error') return 'log-error';
    if (level === 'warn') return 'log-warn';
    return 'log-info';
}

function goBack() {
    router.push('/');
}
</script>

<template>
    <div class="kiosk-container technician-view">
        <header class="tech-header">
            <button class="back-btn" type="button" @click="goBack">
                <ArrowLeft :size="28" />
                {{ t.back }}
            </button>
            <h1 class="tech-title">
                <Wrench :size="32" />
                {{ t.title }}
            </h1>
        </header>

        <div v-if="!unlocked" class="unlock-panel">
            <Lock :size="48" class="mb-4" />
            <p class="unlock-hint">{{ t.locked }}</p>
            <label class="field-label">{{ t.password }}</label>
            <input
                v-model="password"
                type="password"
                class="tech-input"
                autocomplete="off"
                @keyup.enter="tryUnlock"
            />
            <p v-if="unlockError" class="error-text">{{ unlockError }}</p>
            <button class="kiosk-btn btn-primary unlock-btn" type="button" @click="tryUnlock">
                <Unlock :size="22" />
                {{ t.unlock }}
            </button>
        </div>

        <div v-else class="tech-body">
            <section class="tech-card">
                <h2>{{ t.device }}</h2>
                <p class="meta-line"><strong>ID:</strong> {{ store.deviceProfile?.username ?? '—' }}</p>
                <label class="field-label">{{ t.location }}</label>
                <div class="location-row">
                    <input v-model="locationInput" class="tech-input" type="text" maxlength="255" />
                    <button
                        class="kiosk-btn btn-secondary save-btn"
                        type="button"
                        :disabled="savingLocation"
                        @click="saveLocation"
                    >
                        <Save :size="20" />
                        {{ t.save }}
                    </button>
                </div>
                <p v-if="saveMessage" class="save-msg">{{ saveMessage }}</p>
                <p class="stats-line">
                    {{ t.retain }}: {{ stats.retainDays }} {{ t.days }} ·
                    {{ t.maxDay }}: {{ stats.maxDayMb }} MB
                </p>
            </section>

            <section class="tech-card logs-card">
                <div class="logs-toolbar">
                    <h2>{{ t.logs }}</h2>
                    <button class="kiosk-btn btn-secondary copy-btn" type="button" @click="copyLogs">
                        <Copy :size="18" />
                        {{ t.export }}
                    </button>
                </div>
                <p v-if="copyMessage" class="save-msg">{{ copyMessage }}</p>

                <div class="filters">
                    <label>
                        {{ t.day }}
                        <select v-model="selectedDay" class="tech-select">
                            <option v-for="d in days" :key="d" :value="d">{{ d }}</option>
                        </select>
                    </label>
                    <label>
                        {{ t.category }}
                        <select v-model="categoryFilter" class="tech-select">
                            <option v-for="c in categories" :key="c" :value="c">
                                {{ c === 'all' ? t.all : c }}
                            </option>
                        </select>
                    </label>
                </div>

                <div class="log-list">
                    <p v-if="entries.length === 0" class="empty-msg">{{ t.empty }}</p>
                    <article
                        v-for="(e, idx) in entries"
                        :key="`${e.ts}-${idx}`"
                        class="log-row"
                        :class="levelClass(e.level)"
                    >
                        <div class="log-head">
                            <span class="log-time">{{ e.iso }}</span>
                            <span class="log-badge">{{ e.category }}</span>
                            <span class="log-level">{{ e.level }}</span>
                        </div>
                        <p class="log-msg">{{ e.message }}</p>
                        <pre v-if="e.data" class="log-data">{{ JSON.stringify(e.data, null, 0) }}</pre>
                    </article>
                </div>
            </section>
        </div>
    </div>
</template>

<style scoped>
.technician-view {
    padding: 1.5rem 2rem 2rem;
    align-items: stretch;
    justify-content: flex-start;
    overflow-y: auto;
}

.tech-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
}

.back-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: 2px solid var(--text-muted);
    color: var(--text-color);
    padding: 0.5rem 1rem;
    border-radius: 2rem;
    font-weight: 600;
    cursor: pointer;
}

.tech-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 1.75rem;
    margin: 0;
}

.unlock-panel {
    max-width: 420px;
    margin: 4rem auto;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    text-align: center;
}

.unlock-hint {
    color: var(--text-muted);
    margin-bottom: 1.5rem;
}

.field-label {
    text-align: left;
    font-weight: 600;
    margin-bottom: 0.35rem;
    font-size: 0.95rem;
}

.tech-input {
    width: 100%;
    padding: 0.85rem 1rem;
    border: 2px solid #cbd5e1;
    border-radius: 0.75rem;
    font-size: 1.1rem;
    margin-bottom: 0.75rem;
}

.unlock-btn {
    margin-top: 0.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
}

.error-text {
    color: #dc2626;
    font-weight: 600;
    margin-bottom: 0.5rem;
}

.tech-body {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    max-width: 960px;
    width: 100%;
    margin: 0 auto;
}

.tech-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 1rem;
    padding: 1.25rem 1.5rem;
    box-shadow: 0 1px 3px rgb(0 0 0 / 6%);
}

.tech-card h2 {
    margin: 0 0 0.75rem;
    font-size: 1.2rem;
}

.meta-line, .stats-line {
    margin: 0 0 0.75rem;
    color: var(--text-muted);
    font-size: 0.95rem;
}

.location-row {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
}

.location-row .tech-input {
    flex: 1;
    margin-bottom: 0;
}

.save-btn, .copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    white-space: nowrap;
}

.save-msg {
    color: #059669;
    font-weight: 600;
    margin-top: 0.5rem;
}

.logs-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
}

.logs-toolbar h2 {
    margin: 0;
}

.filters {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 1rem;
    font-size: 0.95rem;
    font-weight: 600;
}

.tech-select {
    display: block;
    margin-top: 0.25rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid #cbd5e1;
    min-width: 10rem;
}

.log-list {
    max-height: 50vh;
    overflow-y: auto;
    border: 1px solid #e2e8f0;
    border-radius: 0.75rem;
    background: #f8fafc;
}

.empty-msg {
    padding: 2rem;
    text-align: center;
    color: var(--text-muted);
}

.log-row {
    padding: 0.65rem 0.85rem;
    border-bottom: 1px solid #e2e8f0;
    font-size: 0.85rem;
}

.log-row:last-child {
    border-bottom: none;
}

.log-head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.25rem;
}

.log-time {
    font-family: ui-monospace, monospace;
    color: #475569;
}

.log-badge {
    background: #e2e8f0;
    padding: 0.1rem 0.45rem;
    border-radius: 0.35rem;
    text-transform: uppercase;
    font-size: 0.7rem;
    font-weight: 700;
}

.log-level {
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.7rem;
}

.log-error .log-level { color: #dc2626; }
.log-warn .log-level { color: #d97706; }
.log-info .log-level { color: #2563eb; }

.log-msg {
    margin: 0;
    font-weight: 600;
}

.log-data {
    margin: 0.35rem 0 0;
    white-space: pre-wrap;
    word-break: break-all;
    font-size: 0.75rem;
    color: #64748b;
}
</style>
