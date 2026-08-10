/**
 * On-device kiosk event log — daily .txt files via Capacitor Filesystem (90-day retention).
 * Upload cursor stays in localStorage; pending cash top-up is unchanged.
 */
import {
    appendLogEntry,
    clearAllLogFiles,
    collectEntriesAfterTs,
    estimateLogStorageBytes,
    initKioskLogFilesystem,
    listLogDays,
    LOG_RETAIN_DAYS,
    migrateLegacyLocalStorageLogs,
    pruneLogsOlderThan,
    readLogDay,
} from './kioskLogFileStore';

export type {
    KioskLogCategory,
    KioskLogEntry,
    KioskLogLevel,
} from './kioskLogTypes';

import type { KioskLogCategory, KioskLogEntry, KioskLogLevel } from './kioskLogTypes';

let cachedDeviceName = '';
let initialized = false;
let writeChain = Promise.resolve();

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

function enqueueWrite(fn: () => Promise<void>): void {
    writeChain = writeChain.then(fn).catch((e) => {
        console.warn('[KioskLog] write failed:', e);
    });
}

/** Boot-time init: migrate legacy localStorage buckets, prune files older than 90 days. */
export async function initKioskLogs(): Promise<void> {
    if (initialized) return;
    await initKioskLogFilesystem();
    initialized = true;
    logKioskEvent('system', 'info', 'Kiosk log initialized', await getKioskLogStorageStats());
}

/** No-op — logs no longer use localStorage quota. Kept for call-site compatibility. */
export function ensureStorageSpace(): void {
    /* logs are on filesystem */
}

export function logKioskEvent(
    category: KioskLogCategory,
    level: KioskLogLevel,
    message: string,
    data?: Record<string, unknown>,
): void {
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

    enqueueWrite(() => appendLogEntry(entry));
}

export async function listKioskLogDays(): Promise<string[]> {
    return listLogDays();
}

export async function getKioskLogsForDay(day: string): Promise<KioskLogEntry[]> {
    return readLogDay(day);
}

export async function getKioskLogsRecent(limit = 200): Promise<KioskLogEntry[]> {
    const days = await listLogDays();
    const all: KioskLogEntry[] = [];
    for (const day of days) {
        all.push(...(await readLogDay(day)));
        if (all.length >= limit) break;
    }
    return all.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export async function exportKioskLogsText(day?: string): Promise<string> {
    const entries = day ? await getKioskLogsForDay(day) : await getKioskLogsRecent(500);
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

export async function getKioskLogStorageStats(): Promise<{
    days: number;
    retainDays: number;
    estimatedMb: number;
}> {
    const days = await listLogDays();
    const bytes = await estimateLogStorageBytes();
    return {
        days: days.length,
        retainDays: LOG_RETAIN_DAYS,
        estimatedMb: Math.round((bytes / (1024 * 1024)) * 10) / 10,
    };
}

/** Technician / recovery — wipe all on-device log files and reset upload cursor. */
export async function clearAllKioskLogs(): Promise<void> {
    await clearAllLogFiles();
    try {
        localStorage.setItem('kiosk-log-upload-cursor-ts', '0');
    } catch {
        /* best-effort */
    }
}

/** Used by kioskLogUploader — collect entries with ts > cursor, oldest-first. */
export async function collectKioskLogsAfterTs(cursorTs: number, maxEntries: number): Promise<KioskLogEntry[]> {
    return collectEntriesAfterTs(cursorTs, maxEntries);
}

export { migrateLegacyLocalStorageLogs, pruneLogsOlderThan };
