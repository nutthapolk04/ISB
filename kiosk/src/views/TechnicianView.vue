<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
    ArrowLeft,
    Lock,
    Unlock,
    Save,
    Copy,
    Wrench,
    Shield,
    Activity,
    MapPin,
    Database,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Info,
    Search,
} from 'lucide-vue-next';
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
    type KioskLogLevel,
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
const searchQuery = ref('');

const selectedDay = ref('');
const categoryFilter = ref<KioskLogCategory | 'all'>('all');

const stats = computed(() => getKioskLogStorageStats());
const days = computed(() => listKioskLogDays());

const dayEntries = computed((): KioskLogEntry[] => {
    const day = selectedDay.value || days.value[0] || new Date().toISOString().slice(0, 10);
    return getKioskLogsForDay(day);
});

const filtered = computed((): KioskLogEntry[] => {
    const q = searchQuery.value.trim().toLowerCase();
    return dayEntries.value.filter((e) => {
        if (categoryFilter.value !== 'all' && e.category !== categoryFilter.value) return false;
        if (q && !`${e.message} ${e.category} ${e.level}`.toLowerCase().includes(q)) return false;
        return true;
    });
});

const counts = computed(() => ({
    total: dayEntries.value.length,
    errors: dayEntries.value.filter((l) => l.level === 'error').length,
    warns: dayEntries.value.filter((l) => l.level === 'warn').length,
}));

const firmwareLabel = computed(() => `v${__APP_VERSION__} · build ${__BUILD_TIME__}`);

const categories: Array<KioskLogCategory | 'all'> = [
    'all', 'system', 'auth', 'api', 'bill', 'cash', 'qr', 'pending',
];

const t = computed(() => ({
    EN: {
        console: 'Technician Console',
        title: 'Device Operations',
        online: 'Online',
        restricted: 'Restricted Access',
        locked: 'Enter the device password to open the technician console.',
        password: 'Device password',
        unlock: 'Unlock console',
        wrongPassword: 'Incorrect password',
        deviceAccount: 'Device Account',
        deviceId: 'Device ID',
        firmware: 'Firmware',
        location: 'Installation location',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Location saved',
        retention: 'Retention',
        maxDay: 'Max per day',
        days: 'days',
        eventLog: 'Event Log',
        entriesOf: (n: number, total: number) => `${n} of ${total} entries`,
        copy: 'Copy',
        copied: 'Copied to clipboard',
        copyFailed: 'Copy failed',
        search: 'Search messages…',
        all: 'All',
        empty: 'No log entries match your filter',
        back: 'Back',
        uptime: 'Status',
        logEntries: 'Log entries',
        warnings: 'Warnings',
        errors: 'Errors',
        day: 'Day',
    },
    TH: {
        console: 'ผู้ดูแลเครื่อง',
        title: 'การดำเนินงานเครื่อง',
        online: 'ออนไลน์',
        restricted: 'การเข้าถึงถูกจำกัด',
        locked: 'ใส่รหัสผ่านเครื่องเพื่อเปิดหน้าผู้ดูแล',
        password: 'รหัสผ่านเครื่อง',
        unlock: 'ปลดล็อก',
        wrongPassword: 'รหัสผ่านไม่ถูกต้อง',
        deviceAccount: 'บัญชีเครื่อง',
        deviceId: 'รหัสเครื่อง',
        firmware: 'เฟิร์มแวร์',
        location: 'จุดติดตั้ง',
        save: 'บันทึก',
        saving: 'กำลังบันทึก…',
        saved: 'บันทึกแล้ว',
        retention: 'เก็บย้อนหลัง',
        maxDay: 'สูงสุดต่อวัน',
        days: 'วัน',
        eventLog: 'บันทึกเหตุการณ์',
        entriesOf: (n: number, total: number) => `${n} จาก ${total} รายการ`,
        copy: 'คัดลอก',
        copied: 'คัดลอกแล้ว',
        copyFailed: 'คัดลอกไม่สำเร็จ',
        search: 'ค้นหาข้อความ…',
        all: 'ทั้งหมด',
        empty: 'ไม่พบ log ตามตัวกรอง',
        back: 'กลับ',
        uptime: 'สถานะ',
        logEntries: 'รายการ log',
        warnings: 'คำเตือน',
        errors: 'ข้อผิดพลาด',
        day: 'วันที่',
    },
}[store.language]));

function categoryTone(c: KioskLogCategory | 'all'): string {
    const map: Record<string, string> = {
        system: 'tone-system',
        auth: 'tone-auth',
        api: 'tone-api',
        bill: 'tone-bill',
        cash: 'tone-cash',
        qr: 'tone-qr',
        pending: 'tone-pending',
        all: 'tone-system',
    };
    return map[c] ?? map.all;
}

function categoryPillClass(c: KioskLogCategory | 'all', active: boolean): string {
    if (active) return 'pill pill-active';
    return `pill ${categoryTone(c)}`;
}

function levelIcon(level: KioskLogLevel) {
    if (level === 'error') return XCircle;
    if (level === 'warn') return AlertTriangle;
    return Info;
}

function levelIconClass(level: KioskLogLevel): string {
    if (level === 'error') return 'icon-error';
    if (level === 'warn') return 'icon-warn';
    return 'icon-info';
}

const logTimeFormatter = computed(() => new Intl.DateTimeFormat(
    store.language === 'TH' ? 'th-TH' : 'en-GB',
    {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    },
));

function formatLogTime(ts: number): string {
    return logTimeFormatter.value.format(new Date(ts));
}

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
        setTimeout(() => { saveMessage.value = ''; }, 2000);
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
        copyMessage.value = t.value.copyFailed;
    }
}

function goBack() {
    router.push('/');
}
</script>

<template>
    <div class="tech-page">
        <!-- Ambient background -->
        <div class="tech-ambient" aria-hidden="true">
            <div class="ambient-blob ambient-blob-top" />
            <div class="ambient-blob ambient-blob-bottom" />
            <div class="ambient-grid" />
        </div>

        <div class="tech-shell">
            <!-- Top bar -->
            <header class="tech-topbar">
                <div class="tech-topbar-left">
                    <button class="back-pill" type="button" @click="goBack">
                        <ArrowLeft :size="16" />
                        {{ t.back }}
                    </button>
                    <div class="tech-heading">
                        <div class="tech-eyebrow">
                            <Wrench :size="14" />
                            {{ t.console }}
                        </div>
                        <h1 class="tech-h1">{{ t.title }}</h1>
                    </div>
                </div>
                <div v-if="store.isReady" class="online-pill">
                    <span class="online-dot-wrap">
                        <span class="online-dot-ping" />
                        <span class="online-dot" />
                    </span>
                    {{ t.online }}
                </div>
            </header>

            <!-- Unlock -->
            <div v-if="!unlocked" class="unlock-wrap">
                <div class="unlock-card">
                    <div class="unlock-icon-wrap">
                        <Lock :size="24" class="unlock-icon" />
                    </div>
                    <h2 class="unlock-title">{{ t.restricted }}</h2>
                    <p class="unlock-sub">{{ t.locked }}</p>

                    <label class="field-label">{{ t.password }}</label>
                    <input v-model="password" type="password" class="tech-input" autocomplete="off"
                        @keyup.enter="tryUnlock" />
                    <p v-if="unlockError" class="error-line">
                        <XCircle :size="14" />
                        {{ unlockError }}
                    </p>
                    <button class="btn-primary-full" type="button" @click="tryUnlock">
                        <Unlock :size="16" />
                        {{ t.unlock }}
                    </button>
                </div>
            </div>

            <!-- Unlocked -->
            <div v-else class="tech-stack">
                <!-- Stats -->
                <section class="stat-grid">
                    <div class="stat-card">
                        <div class="stat-label stat-tone-emerald">
                            <Activity :size="16" />
                            {{ t.uptime }}
                        </div>
                        <div class="stat-value">{{ store.isReady ? t.online : '—' }}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label stat-tone-sky">
                            <Database :size="16" />
                            {{ t.logEntries }}
                        </div>
                        <div class="stat-value">{{ counts.total }}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label stat-tone-amber">
                            <AlertTriangle :size="16" />
                            {{ t.warnings }}
                        </div>
                        <div class="stat-value">{{ counts.warns }}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label stat-tone-rose">
                            <XCircle :size="16" />
                            {{ t.errors }}
                        </div>
                        <div class="stat-value">{{ counts.errors }}</div>
                    </div>
                </section>

                <!-- Device -->
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

                    <p class="retention-line">
                        {{ t.retention }}: <span>{{ stats.retainDays }} {{ t.days }}</span> ·
                        {{ t.maxDay }}: <span>{{ stats.maxDayMb }} MB</span>
                    </p>
                </section>

                <!-- Logs -->
                <section class="panel-card panel-flush">
                    <div class="logs-header">
                        <div class="logs-header-text">
                            <div class="panel-title-row">
                                <Activity :size="16" class="panel-title-icon" />
                                <h2 class="panel-title">{{ t.eventLog }}</h2>
                            </div>
                            <p class="logs-sub">{{ t.entriesOf(filtered.length, counts.total) }}</p>
                        </div>
                        <button class="btn-outline" type="button" @click="copyLogs">
                            <Copy :size="14" />
                            {{ t.copy }}
                        </button>
                    </div>

                    <p v-if="copyMessage" class="copy-banner">{{ copyMessage }}</p>

                    <div class="logs-toolbar">
                        <div class="search-wrap">
                            <Search :size="16" class="search-icon" />
                            <input v-model="searchQuery" class="tech-input search-input" type="search"
                                :placeholder="t.search" />
                        </div>

                        <label v-if="days.length > 1" class="day-picker">
                            {{ t.day }}
                            <select v-model="selectedDay" class="day-select">
                                <option v-for="d in days" :key="d" :value="d">{{ d }}</option>
                            </select>
                        </label>

                        <div class="pill-row">
                            <button v-for="c in categories" :key="c" type="button"
                                :class="categoryPillClass(c, categoryFilter === c)" @click="categoryFilter = c">
                                {{ c === 'all' ? t.all : c }}
                            </button>
                        </div>
                    </div>

                    <div class="log-scroll">
                        <p v-if="filtered.length === 0" class="empty-msg">{{ t.empty }}</p>
                        <ul v-else class="log-list">
                            <li v-for="(e, idx) in filtered" :key="`${e.ts}-${idx}`" class="log-item">
                                <component :is="levelIcon(e.level)" :size="16"
                                    :class="['log-level-icon', levelIconClass(e.level)]" />
                                <div class="log-body">
                                    <div class="log-meta">
                                        <span :class="['cat-badge', categoryTone(e.category)]">{{ e.category }}</span>
                                        <span class="log-time">{{ formatLogTime(e.ts) }}</span>
                                    </div>
                                    <p class="log-message">{{ e.message }}</p>
                                    <pre v-if="e.data" class="log-json">{{ JSON.stringify(e.data) }}</pre>
                                </div>
                            </li>
                        </ul>
                    </div>
                </section>
            </div>
        </div>
    </div>
</template>

<style scoped>
.tech-page {
    height: 100vh;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: #f8fafc;
    color: #0f172a;
    overflow: hidden;
    position: relative;
}

.tech-ambient {
    pointer-events: none;
    position: fixed;
    inset: 0;
    overflow: hidden;
    z-index: 0;
}

.ambient-blob {
    position: absolute;
    border-radius: 9999px;
    filter: blur(64px);
}




.ambient-grid {
    position: absolute;
    inset: 0;
    opacity: 0.04;
    background-image:
        linear-gradient(rgb(15 23 42 / 60%) 1px, transparent 1px),
        linear-gradient(90deg, rgb(15 23 42 / 60%) 1px, transparent 1px);
    background-size: 40px 40px;
}

.tech-shell {
    position: relative;
    z-index: 1;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    max-width: 72rem;
    width: 100%;
    margin: 0 auto;
    padding: 1rem 1rem 1.25rem;
    overflow: hidden;
}

@media (min-width: 640px) {
    .tech-shell {
        padding: 1.25rem 1.5rem 1.5rem;
    }
}

/* Top bar */
.tech-topbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
    flex-shrink: 0;
}

.tech-topbar-left {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.75rem;
}

.back-pill {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.375rem;
    border-radius: 9999px;
    border: 1px solid #e2e8f0;
    background: #fff;
    padding: 0.375rem 0.75rem;
    font-size: 0.875rem;
    color: #475569;
    cursor: pointer;
    box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
    transition: border-color 0.15s, color 0.15s;
}

.back-pill:hover {
    border-color: #cbd5e1;
    color: #0f172a;
}

.tech-heading {
    min-width: 0;
}

.tech-eyebrow {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #64748b;
}

.tech-h1 {
    margin: 0.125rem 0 0;
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

@media (min-width: 640px) {
    .tech-h1 {
        font-size: 1.875rem;
    }
}

.online-pill {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.5rem;
    border-radius: 9999px;
    border: 1px solid #a7f3d0;
    background: #ecfdf5;
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: #047857;
}

.online-dot-wrap {
    position: relative;
    display: flex;
    height: 0.5rem;
    width: 0.5rem;
}

.online-dot-ping {
    position: absolute;
    inset: 0;
    border-radius: 9999px;
    background: rgb(52 211 153 / 70%);
    animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
}

.online-dot {
    position: relative;
    display: inline-flex;
    height: 0.5rem;
    width: 0.5rem;
    border-radius: 9999px;
    background: #10b981;
}

@keyframes ping {

    75%,
    100% {
        transform: scale(2);
        opacity: 0;
    }
}

/* Unlock */
.unlock-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    max-width: 28rem;
    width: 100%;
    margin: 0 auto;
    overflow-y: auto;
}

.unlock-card {
    border-radius: 1rem;
    border: 1px solid #e2e8f0;
    background: #fff;
    padding: 2rem;
    box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
    text-align: center;
}

.unlock-icon-wrap {
    margin: 0 auto;
    display: flex;
    height: 3.5rem;
    width: 3.5rem;
    align-items: center;
    justify-content: center;
    border-radius: 1rem;
    background: linear-gradient(to bottom, #e0e7ff, #eef2ff);
    box-shadow: inset 0 0 0 1px #c7d2fe;
}

.unlock-icon {
    color: #2563eb;
}

.unlock-title {
    margin: 1.25rem 0 0;
    font-size: 1.125rem;
    font-weight: 600;
}

.unlock-sub {
    margin: 0.25rem 0 0;
    font-size: 0.875rem;
    color: #64748b;
}

.field-label {
    display: block;
    margin-top: 1.5rem;
    margin-bottom: 0.375rem;
    text-align: left;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #64748b;
}

.field-label.with-icon {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0;
}

.tech-input {
    width: 100%;
    border-radius: 0.75rem;
    border: 1px solid #e2e8f0;
    background: #fff;
    padding: 0.625rem 0.875rem;
    font-size: 0.875rem;
    color: #0f172a;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
}

.tech-input:focus {
    border-color: #2563eb;
    /* box-shadow: 0 0 0 3px rgb(199 210 254 / 60%); */
}

.error-line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    margin: 0.5rem 0 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: #e11d48;
}

.btn-primary-full {
    margin-top: 1.25rem;
    display: inline-flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: none;
    border-radius: 0.75rem;
    background: #2563eb;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: #fff;
    cursor: pointer;
    box-shadow: 0 1px 2px rgb(99 102 241 / 20%);
    transition: filter 0.15s;
}

.btn-primary-full:hover {
    filter: brightness(1.05);
}

/* Unlocked stack */
.tech-stack {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    overflow: hidden;
}

.stat-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
    flex-shrink: 0;
}

@media (min-width: 640px) {
    .stat-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
    }
}

.stat-card {
    border-radius: 0.75rem;
    border: 1px solid #e2e8f0;
    background: #fff;
    padding: 0.75rem;
    box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
}

.stat-label {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}

.stat-tone-emerald {
    color: #059669;
}

.stat-tone-sky {
    color: #0284c7;
}

.stat-tone-amber {
    color: #d97706;
}

.stat-tone-rose {
    color: #e11d48;
}

.stat-value {
    margin-top: 0.5rem;
    font-size: 1.25rem;
    font-weight: 600;
}

.panel-card {
    border-radius: 1rem;
    border: 1px solid #e2e8f0;
    background: #fff;
    padding: 1rem;
    box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
    flex-shrink: 0;
}

@media (min-width: 640px) {
    .panel-card {
        padding: 1.5rem;
    }
}

.panel-flush {
    padding: 0;
    overflow: hidden;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

.panel-title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.panel-title-icon {
    color: #64748b;
}

.panel-title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #475569;
}

.field-grid {
    display: grid;
    gap: 1rem;
    margin-top: 1rem;
}

@media (min-width: 640px) {
    .field-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

.field-dt {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #64748b;
}

.field-dd {
    margin: 0.25rem 0 0;
    font-size: 0.875rem;
    color: #0f172a;
}

.field-dd.mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.location-block {
    margin-top: 1.25rem;
}

.location-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.5rem;
    align-items: stretch;
}

.btn-primary {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    border: none;
    border-radius: 0.75rem;
    background: #2563eb;
    padding: 0.625rem 1rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: #fff;
    cursor: pointer;
    box-shadow: 0 1px 2px rgb(99 102 241 / 20%);
    transition: filter 0.15s;
}

.btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.btn-primary:hover:not(:disabled) {
    filter: brightness(1.05);
}

.success-line {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin: 0.5rem 0 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: #059669;
}

.retention-line {
    margin: 1.25rem 0 0;
    padding-top: 1rem;
    border-top: 1px solid #f1f5f9;
    font-size: 0.75rem;
    color: #64748b;
}

.retention-line span {
    color: #334155;
}

/* Logs panel */
.logs-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1rem 0;
    flex-shrink: 0;
}

@media (min-width: 640px) {
    .logs-header {
        padding: 1.25rem 1.25rem 0;
    }
}

.logs-sub {
    margin: 0.125rem 0 0;
    font-size: 0.75rem;
    color: #64748b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.btn-outline {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.375rem;
    border-radius: 0.5rem;
    border: 1px solid #e2e8f0;
    background: #fff;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: #334155;
    cursor: pointer;
    box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
    transition: background 0.15s, border-color 0.15s;
}

.btn-outline:hover {
    border-color: #cbd5e1;
    background: #f8fafc;
}

.copy-banner {
    margin: 0;
    padding: 0.5rem 1.5rem;
    border-bottom: 1px solid #f1f5f9;
    background: #ecfdf5;
    font-size: 0.75rem;
    font-weight: 600;
    color: #047857;
    flex-shrink: 0;
}

.logs-toolbar {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #f1f5f9;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex-shrink: 0;
}

@media (min-width: 640px) {
    .logs-toolbar {
        padding: 1.5rem;
    }
}

.search-wrap {
    position: relative;
}

.search-icon {
    position: absolute;
    left: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    color: #94a3b8;
    pointer-events: none;
}

.search-input {
    padding-left: 2.25rem;
}

.day-picker {
    font-size: 0.75rem;
    font-weight: 600;
    color: #64748b;
}

.day-select {
    display: block;
    margin-top: 0.25rem;
    border-radius: 0.5rem;
    border: 1px solid #e2e8f0;
    padding: 0.375rem 0.625rem;
    font-size: 0.875rem;
    background: #fff;
}

.pill-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
}

.pill {
    display: inline-flex;
    align-items: center;
    border-radius: 9999px;
    padding: 0.25rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    border: none;
    cursor: pointer;
    box-shadow: inset 0 0 0 1px transparent;
    transition: filter 0.15s;
}

.pill:hover {
    filter: brightness(0.97);
}

.pill-active {
    background: #0f172a;
    color: #fff;
    box-shadow: inset 0 0 0 1px #0f172a;
}

.tone-system {
    background: #f1f5f9;
    color: #334155;
    box-shadow: inset 0 0 0 1px #e2e8f0;
}

.tone-auth {
    background: #f5f3ff;
    color: #6d28d9;
    box-shadow: inset 0 0 0 1px #ddd6fe;
}

.tone-api {
    background: #f0f9ff;
    color: #0369a1;
    box-shadow: inset 0 0 0 1px #bae6fd;
}

.tone-bill {
    background: #fffbeb;
    color: #b45309;
    box-shadow: inset 0 0 0 1px #fde68a;
}

.tone-cash {
    background: #ecfdf5;
    color: #047857;
    box-shadow: inset 0 0 0 1px #a7f3d0;
}

.tone-qr {
    background: #fdf4ff;
    color: #a21caf;
    box-shadow: inset 0 0 0 1px #f5d0fe;
}

.tone-pending {
    background: #fff7ed;
    color: #c2410c;
    box-shadow: inset 0 0 0 1px #fed7aa;
}

.log-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
}

.empty-msg {
    padding: 2.5rem;
    text-align: center;
    font-size: 0.875rem;
    color: #64748b;
}

.log-list {
    list-style: none;
    margin: 0;
    padding: 0;
}

.log-item {
    display: flex;
    gap: 0.75rem;
    padding: 0.875rem 1.25rem;
    border-top: 1px solid #f1f5f9;
    transition: background 0.15s;
}

@media (min-width: 640px) {
    .log-item {
        padding: 0.875rem 1.5rem;
    }
}

.log-item:hover {
    background: #f8fafc;
}

.log-level-icon {
    flex-shrink: 0;
    margin-top: 0.125rem;
}

.icon-error {
    color: #f43f5e;
}

.icon-warn {
    color: #f59e0b;
}

.icon-info {
    color: #0ea5e9;
}

.log-body {
    min-width: 0;
    flex: 1;
}

.log-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
}

.cat-badge {
    display: inline-flex;
    align-items: center;
    border-radius: 0.375rem;
    padding: 0.125rem 0.375rem;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}

.log-time {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.6875rem;
    color: #64748b;
    white-space: nowrap;
}

.log-message {
    margin: 0.25rem 0 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: #0f172a;
    overflow-wrap: anywhere;
    word-break: break-word;
}

.log-json {
    margin: 0.25rem 0 0;
    max-height: 6rem;
    overflow: auto;
    border-radius: 0.375rem;
    background: #f8fafc;
    padding: 0.25rem 0.5rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.6875rem;
    color: #475569;
    box-shadow: inset 0 0 0 1px #f1f5f9;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
</style>
