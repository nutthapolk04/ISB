<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
    Activity,
    AlertTriangle,
    Copy,
    Info,
    Search,
    XCircle,
} from 'lucide-vue-next';
import {
    exportKioskLogsText,
    getKioskLogsForDay,
    listKioskLogDays,
    type KioskLogCategory,
    type KioskLogEntry,
    type KioskLogLevel,
} from '../../lib/kioskLog';
import { useTechnicianI18n } from '../../lib/technicianI18n';
import { useKioskStore } from '../../stores/kioskStore';

const store = useKioskStore();
const t = useTechnicianI18n();

const searchQuery = ref('');
const copyMessage = ref('');
const selectedDay = ref('');
const categoryFilter = ref<KioskLogCategory | 'all'>('all');
const days = ref<string[]>([]);
const dayEntries = ref<KioskLogEntry[]>([]);
const logsLoading = ref(false);

const categories: Array<KioskLogCategory | 'all'> = [
    'all', 'PING', 'TAP', 'TOPUP', 'CLEAR-CASH-BOX', 'LOCK', 'UNLOCK', 'system',
];

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

function categoryTone(c: KioskLogCategory | 'all'): string {
    const map: Record<string, string> = {
        PING: 'tone-api',
        TAP: 'tone-auth',
        TOPUP: 'tone-cash',
        'CLEAR-CASH-BOX': 'tone-bill',
        LOCK: 'tone-pending',
        UNLOCK: 'tone-pending',
        system: 'tone-system',
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

function formatLogTime(ts: number): string {
    return logTimeFormatter.value.format(new Date(ts));
}

async function refreshLogView(): Promise<void> {
    logsLoading.value = true;
    try {
        const dayList = await listKioskLogDays();
        days.value = dayList;
        if (!selectedDay.value || !dayList.includes(selectedDay.value)) {
            selectedDay.value = dayList[0] ?? new Date().toISOString().slice(0, 10);
        }
        const day = selectedDay.value || dayList[0] || new Date().toISOString().slice(0, 10);
        dayEntries.value = await getKioskLogsForDay(day);
    } finally {
        logsLoading.value = false;
    }
}

async function copyLogs() {
    const text = await exportKioskLogsText(selectedDay.value || undefined);
    try {
        await navigator.clipboard.writeText(text);
        copyMessage.value = t.value.copied;
        setTimeout(() => { copyMessage.value = ''; }, 2000);
    } catch {
        copyMessage.value = t.value.copyFailed;
    }
}

onMounted(() => {
    void refreshLogView();
});

watch(selectedDay, () => {
    void refreshLogView();
});
</script>

<template>
    <div class="tech-stack">
        <section class="stat-grid">
            <div class="stat-card">
                <div class="stat-label stat-tone-sky">
                    <Activity :size="16" />
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

        <section class="panel-card panel-flush">
            <div class="logs-header">
                <div class="logs-header-text">
                    <div class="panel-title-row">
                        <Activity :size="16" class="panel-title-icon" />
                        <h2 class="panel-title">{{ t.eventLog }}</h2>
                    </div>
                    <p class="logs-sub">{{ t.entriesOf(filtered.length, counts.total) }}</p>
                </div>
                <div class="logs-header-actions">
                    <button class="btn-outline" type="button" @click="copyLogs">
                        <Copy :size="14" />
                        {{ t.copy }}
                    </button>
                </div>
            </div>

            <p v-if="copyMessage" class="copy-banner">{{ copyMessage }}</p>

            <div class="logs-toolbar">
                <div class="search-wrap">
                    <Search :size="16" class="search-icon" />
                    <input v-model="searchQuery" class="tech-input search-input" type="search" :placeholder="t.search" />
                </div>

                <label v-if="days.length > 1" class="day-picker">
                    {{ t.day }}
                    <select v-model="selectedDay" class="day-select">
                        <option v-for="d in days" :key="d" :value="d">{{ d }}</option>
                    </select>
                </label>

                <div class="pill-row">
                    <button
                        v-for="c in categories"
                        :key="c"
                        type="button"
                        :class="categoryPillClass(c, categoryFilter === c)"
                        @click="categoryFilter = c"
                    >
                        {{ c === 'all' ? t.all : c }}
                    </button>
                </div>
            </div>

            <div class="log-scroll">
                <p v-if="logsLoading" class="empty-msg">{{ t.loadingLogs }}</p>
                <p v-else-if="filtered.length === 0" class="empty-msg">{{ t.empty }}</p>
                <ul v-else class="log-list">
                    <li v-for="(e, idx) in filtered" :key="`${e.ts}-${idx}`" class="log-item">
                        <component :is="levelIcon(e.level)" :size="16" :class="['log-level-icon', levelIconClass(e.level)]" />
                        <div class="log-body">
                            <div class="log-meta">
                                <span :class="['cat-badge', categoryTone(e.category)]">{{ e.category }}</span>
                                <span class="log-time">{{ formatLogTime(e.ts) }}</span>
                            </div>
                            <p class="log-message">{{ e.message }}</p>
                            <pre
                                v-if="e.data && String(e.message).indexOf('[TOPUP]') === -1 && String(e.message).indexOf('[TAP]') === -1"
                                class="log-json"
                            >{{ JSON.stringify(e.data) }}</pre>
                        </div>
                    </li>
                </ul>
            </div>
        </section>
    </div>
</template>

<style scoped src="../../styles/technician.css"></style>
