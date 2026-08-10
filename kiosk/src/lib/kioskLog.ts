/**
 * On-device kiosk event log with daily buckets and rotation.
 * Tuned for Android WebView localStorage (~5 MB total origin quota).
 */

export type KioskLogLevel = 'info' | 'warn' | 'error';

export type KioskLogCategory =
    | 'system'
    | 'auth'
    | 'api'
    | 'bill'
    | 'cash'
    | 'qr'
    | 'pending';

export interface KioskLogEntry {
    ts: number;
    iso: string;
    level: KioskLogLevel;
    category: KioskLogCategory;
    message: string;
    device_id: string;
    device_name: string;
    data?: Record<string, unknown>;
}

const INDEX_KEY = 'kiosk-log-index';
const DAY_PREFIX = 'kiosk-log-day-';
const COMPRESSED_SUFFIX = '.gz.json';

/** Per-day cap — total origin quota is ~5 MB on many Android WebViews. */
const MAX_DAY_BYTES = 512 * 1024;
/** Keep a few days on-device; uploaded rows are pruned by the uploader. */
const RETAIN_DAYS = 3;
/** Target total footprint for all kiosk-log keys (leave headroom for pending top-up, cursor, etc.). */
const QUOTA_TARGET_BYTES = 2.5 * 1024 * 1024;

const KIOSK_STORAGE_PREFIXES = [INDEX_KEY, DAY_PREFIX, 'kiosk-log-upload-cursor-ts'];

let cachedDeviceName = '';

export function setKioskDeviceName(name: string): void {
    cachedDeviceName = name.trim();
}

export function getKioskDeviceId(): string {
    const username = import.meta.env.VITE_KIOSK_USERNAME as string | undefined;
    return username?.trim() || 'unknown-kiosk';
}

export function getKioskDeviceName(): string {
    return cachedDeviceName || getKioskDeviceId();
}

function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function dayStorageKey(day: string): string {
    return `${DAY_PREFIX}${day}`;
}

interface LogIndex {
    days: string[];
}

function readIndex(): LogIndex {
    try {
        const raw = localStorage.getItem(INDEX_KEY);
        if (!raw) return { days: [] };
        const parsed = JSON.parse(raw) as LogIndex;
        return Array.isArray(parsed.days) ? parsed : { days: [] };
    } catch {
        return { days: [] };
    }
}

function writeIndex(index: LogIndex): void {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

function readDayEntries(day: string): KioskLogEntry[] {
    const raw = localStorage.getItem(dayStorageKey(day));
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw) as KioskLogEntry[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeDayEntries(day: string, entries: KioskLogEntry[]): void {
    localStorage.setItem(dayStorageKey(day), JSON.stringify(entries));
}

function decompressLite(blob: string): string {
    if (!blob.startsWith('b64:')) return blob;
    return decodeURIComponent(escape(atob(blob.slice(4))));
}

function readDayEntriesAny(day: string): KioskLogEntry[] {
    const live = readDayEntries(day);
    if (live.length > 0) return live;
    const compressed = localStorage.getItem(`${dayStorageKey(day)}${COMPRESSED_SUFFIX}`);
    if (!compressed) return [];
    try {
        const parsed = JSON.parse(decompressLite(compressed)) as KioskLogEntry[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function trimDayIfNeeded(entries: KioskLogEntry[]): KioskLogEntry[] {
    let trimmed = [...entries];
    let json = JSON.stringify(trimmed);
    while (trimmed.length > 1 && json.length > MAX_DAY_BYTES) {
        trimmed = trimmed.slice(Math.ceil(trimmed.length * 0.1));
        json = JSON.stringify(trimmed);
    }
    if (json.length > MAX_DAY_BYTES && trimmed.length > 0) {
        trimmed = trimmed.slice(-1);
    }
    return trimmed;
}

function removeDayFromStorage(day: string): void {
    localStorage.removeItem(dayStorageKey(day));
    localStorage.removeItem(`${dayStorageKey(day)}${COMPRESSED_SUFFIX}`);
}

function pruneOldDays(index: LogIndex): LogIndex {
    const sorted = [...index.days].sort();
    while (sorted.length > RETAIN_DAYS) {
        const oldest = sorted.shift();
        if (oldest) removeDayFromStorage(oldest);
    }
    return { days: sorted };
}

function rotateIfNewDay(index: LogIndex, today: string): LogIndex {
    const last = index.days[index.days.length - 1];
    if (last && last !== today) {
        removeDayFromStorage(last);
    }
    if (!index.days.includes(today)) {
        index.days.push(today);
    }
    return pruneOldDays(index);
}

/** Rough byte count for kiosk-log keys in localStorage. */
export function estimateKioskLogStorageBytes(): number {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (KIOSK_STORAGE_PREFIXES.some((p) => key.startsWith(p) || key === p)) {
            const val = localStorage.getItem(key);
            total += key.length + (val?.length ?? 0);
        }
    }
    return total;
}

/** Drop oldest log days (then trim today) until under QUOTA_TARGET_BYTES. */
export function ensureStorageSpace(): void {
    const today = todayKey();
    for (let pass = 0; pass < 20 && estimateKioskLogStorageBytes() > QUOTA_TARGET_BYTES; pass++) {
        const index = readIndex();
        const sorted = [...index.days].sort();
        const dropDay = sorted.find((d) => d !== today) ?? (sorted.length === 1 ? today : null);
        if (!dropDay) break;

        if (dropDay === today) {
            const entries = readDayEntries(today);
            if (entries.length <= 20) break;
            writeDayEntries(today, entries.slice(-Math.max(20, Math.floor(entries.length / 2))));
            continue;
        }

        removeDayFromStorage(dropDay);
        writeIndex({ days: index.days.filter((d) => d !== dropDay) });
    }
}

/** Remove on-device rows already uploaded to the server (ts <= upToTs). */
export function deleteUploadedLogsUpTo(upToTs: number): number {
    let removed = 0;
    let index = readIndex();

    for (const day of [...index.days]) {
        const entries = readDayEntriesAny(day);
        const kept = entries.filter((e) => e.ts > upToTs);
        removed += entries.length - kept.length;

        if (kept.length === 0) {
            removeDayFromStorage(day);
            index = { days: index.days.filter((d) => d !== day) };
        } else if (kept.length < entries.length) {
            writeDayEntries(day, kept.sort((a, b) => a.ts - b.ts));
            localStorage.removeItem(`${dayStorageKey(day)}${COMPRESSED_SUFFIX}`);
        }
    }

    writeIndex(index);
    if (removed > 0) ensureStorageSpace();
    return removed;
}

/** Technician / recovery — wipe all kiosk log buckets. */
export function clearAllKioskLogs(): void {
    const index = readIndex();
    for (const day of index.days) {
        removeDayFromStorage(day);
    }
    localStorage.removeItem(INDEX_KEY);
    try {
        localStorage.setItem('kiosk-log-upload-cursor-ts', '0');
    } catch {
        /* best-effort */
    }
}

export function logKioskEvent(
    category: KioskLogCategory,
    level: KioskLogLevel,
    message: string,
    data?: Record<string, unknown>,
): void {
    const today = todayKey();
    const entry: KioskLogEntry = {
        ts: Date.now(),
        iso: new Date().toISOString(),
        level,
        category,
        message,
        device_id: getKioskDeviceId(),
        device_name: getKioskDeviceName(),
        ...(data && Object.keys(data).length > 0 ? { data } : {}),
    };

    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleFn(`[KioskLog:${category}]`, message, data ?? '');

    const persist = (): boolean => {
        let index = readIndex();
        index = rotateIfNewDay(index, today);
        const entries = readDayEntries(today);
        entries.push(entry);
        const trimmed = trimDayIfNeeded(entries);
        writeDayEntries(today, trimmed);
        writeIndex(index);
        return true;
    };

    try {
        persist();
    } catch (e) {
        console.warn('[KioskLog] persist failed, purging:', e);
        try {
            ensureStorageSpace();
            persist();
        } catch (e2) {
            console.warn('[KioskLog] persist failed after purge:', e2);
        }
    }
}

export function listKioskLogDays(): string[] {
    const index = readIndex();
    return [...index.days].sort().reverse();
}

export function getKioskLogsForDay(day: string): KioskLogEntry[] {
    return readDayEntriesAny(day).sort((a, b) => b.ts - a.ts);
}

export function getKioskLogsRecent(limit = 200): KioskLogEntry[] {
    const days = listKioskLogDays();
    const all: KioskLogEntry[] = [];
    for (const day of days) {
        all.push(...readDayEntriesAny(day));
        if (all.length >= limit) break;
    }
    return all.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export function exportKioskLogsText(day?: string): string {
    const entries = day ? getKioskLogsForDay(day) : getKioskLogsRecent(500);
    const header = [
        `Kiosk device: ${getKioskDeviceName()} (${getKioskDeviceId()})`,
        `Exported: ${new Date().toISOString()}`,
        day ? `Day: ${day}` : 'Recent entries',
        '---',
    ].join('\n');
    const lines = entries.map((e) => {
        const data = e.data ? ` ${JSON.stringify(e.data)}` : '';
        return `${e.iso} [${e.level}] [${e.category}] ${e.message}${data}`;
    });
    return [header, ...lines].join('\n');
}

export function getKioskLogStorageStats(): {
    days: number;
    retainDays: number;
    maxDayMb: number;
    estimatedMb: number;
} {
    return {
        days: listKioskLogDays().length,
        retainDays: RETAIN_DAYS,
        maxDayMb: MAX_DAY_BYTES / (1024 * 1024),
        estimatedMb: Math.round((estimateKioskLogStorageBytes() / (1024 * 1024)) * 10) / 10,
    };
}

ensureStorageSpace();
logKioskEvent('system', 'info', 'Kiosk log initialized', getKioskLogStorageStats());
