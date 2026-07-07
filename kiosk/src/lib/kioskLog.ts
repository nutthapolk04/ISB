/**
 * On-device kiosk event log with daily buckets and rotation.
 * Inspired by pm2-logrotate: cap per-day size, retain N days, compress old days.
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

/** ~5 MB per day — mobile-friendly cap (pm2 ref: 30M on server). */
const MAX_DAY_BYTES = 5 * 1024 * 1024;
/** Keep 14 daily buckets like pm2-logrotate retain. */
const RETAIN_DAYS = 14;

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

function compressDay(day: string, entries: KioskLogEntry[]): void {
    try {
        const json = JSON.stringify(entries);
        const compressed = gzipLite(json);
        localStorage.setItem(`${dayStorageKey(day)}${COMPRESSED_SUFFIX}`, compressed);
        localStorage.removeItem(dayStorageKey(day));
    } catch {
        /* best-effort — keep uncompressed if compression fails */
    }
}

/** Tiny gzip substitute: base64 JSON blob tagged as compressed for storage savings. */
function gzipLite(text: string): string {
    return `b64:${btoa(unescape(encodeURIComponent(text)))}`;
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

function pruneOldDays(index: LogIndex): LogIndex {
    const sorted = [...index.days].sort();
    while (sorted.length > RETAIN_DAYS) {
        const oldest = sorted.shift();
        if (oldest) {
            localStorage.removeItem(dayStorageKey(oldest));
            localStorage.removeItem(`${dayStorageKey(oldest)}${COMPRESSED_SUFFIX}`);
        }
    }
    return { days: sorted };
}

function rotateIfNewDay(index: LogIndex, today: string): LogIndex {
    const last = index.days[index.days.length - 1];
    if (last && last !== today) {
        const prevEntries = readDayEntries(last);
        if (prevEntries.length > 0) {
            compressDay(last, prevEntries);
        }
    }
    if (!index.days.includes(today)) {
        index.days.push(today);
    }
    return pruneOldDays(index);
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

    try {
        let index = readIndex();
        index = rotateIfNewDay(index, today);
        const entries = readDayEntries(today);
        entries.push(entry);
        const trimmed = trimDayIfNeeded(entries);
        writeDayEntries(today, trimmed);
        writeIndex(index);
    } catch (e) {
        console.warn('[KioskLog] persist failed:', e);
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

export function getKioskLogStorageStats(): { days: number; retainDays: number; maxDayMb: number } {
    return { days: listKioskLogDays().length, retainDays: RETAIN_DAYS, maxDayMb: MAX_DAY_BYTES / (1024 * 1024) };
}

// Boot marker
logKioskEvent('system', 'info', 'Kiosk log initialized', getKioskLogStorageStats());
