/**
 * On-device kiosk event logs as one NDJSON line per entry in daily .txt files.
 * Uses Capacitor Filesystem (app data dir) — not subject to WebView localStorage quota.
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { KioskLogEntry } from './kioskLogTypes';

export const LOG_RETAIN_DAYS = 90;
const LOG_DIR = 'kiosk-logs';
const LEGACY_INDEX_KEY = 'kiosk-log-index';
const LEGACY_DAY_PREFIX = 'kiosk-log-day-';

const webDayBuffers = new Map<string, string>();

function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function dayFileName(day: string): string {
    return `${day}.txt`;
}

function logFilePath(day: string): string {
    return `${LOG_DIR}/${dayFileName(day)}`;
}

function parseDayFromFileName(name: string): string | null {
    const m = /^(\d{4}-\d{2}-\d{2})\.txt$/.exec(name);
    return m ? m[1] : null;
}

function isNativeFilesystem(): boolean {
    return Capacitor.isNativePlatform();
}

function parseLogLine(line: string): KioskLogEntry | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
        const parsed = JSON.parse(trimmed) as KioskLogEntry;
        if (
            typeof parsed.ts !== 'number'
            || typeof parsed.iso !== 'string'
            || typeof parsed.message !== 'string'
        ) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function serializeLogEntry(entry: KioskLogEntry): string {
    return JSON.stringify(entry);
}

function parseFileContent(content: string): KioskLogEntry[] {
    const entries: KioskLogEntry[] = [];
    for (const line of content.split('\n')) {
        const entry = parseLogLine(line);
        if (entry) entries.push(entry);
    }
    return entries;
}

async function ensureLogDirectory(): Promise<void> {
    if (!isNativeFilesystem()) return;
    try {
        await Filesystem.mkdir({
            path: LOG_DIR,
            directory: Directory.Data,
            recursive: true,
        });
    } catch {
        /* already exists */
    }
}

async function readFileText(path: string): Promise<string> {
    if (!isNativeFilesystem()) {
        const day = parseDayFromFileName(path.split('/').pop() ?? '') ?? path;
        return webDayBuffers.get(day) ?? '';
    }
    try {
        const result = await Filesystem.readFile({
            path,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
        return typeof result.data === 'string' ? result.data : '';
    } catch {
        return '';
    }
}

async function appendFileText(path: string, data: string): Promise<void> {
    if (!isNativeFilesystem()) {
        const day = parseDayFromFileName(path.split('/').pop() ?? '') ?? todayKey();
        webDayBuffers.set(day, (webDayBuffers.get(day) ?? '') + data);
        return;
    }
    try {
        await Filesystem.appendFile({
            path,
            data,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
    } catch {
        await ensureLogDirectory();
        await Filesystem.writeFile({
            path,
            data,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
    }
}

async function deleteFile(path: string): Promise<void> {
    if (!isNativeFilesystem()) {
        const day = parseDayFromFileName(path.split('/').pop() ?? '');
        if (day) webDayBuffers.delete(day);
        return;
    }
    try {
        await Filesystem.deleteFile({ path, directory: Directory.Data });
    } catch {
        /* ignore */
    }
}

function cutoffDayKey(retainDays: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - retainDays);
    return d.toISOString().slice(0, 10);
}

export async function initKioskLogFilesystem(): Promise<void> {
    await ensureLogDirectory();
    await migrateLegacyLocalStorageLogs();
    await pruneLogsOlderThan(LOG_RETAIN_DAYS);
}

export async function appendLogEntry(entry: KioskLogEntry): Promise<void> {
    const day = entry.iso.slice(0, 10);
    const line = `${serializeLogEntry(entry)}\n`;
    await appendFileText(logFilePath(day), line);
}

export async function listLogDays(): Promise<string[]> {
    if (!isNativeFilesystem()) {
        return [...webDayBuffers.keys()].sort().reverse();
    }
    try {
        const result = await Filesystem.readdir({
            path: LOG_DIR,
            directory: Directory.Data,
        });
        return result.files
            .map((f) => parseDayFromFileName(f.name ?? String(f)))
            .filter((d): d is string => !!d)
            .sort()
            .reverse();
    } catch {
        return [];
    }
}

export async function readLogDay(day: string): Promise<KioskLogEntry[]> {
    const content = await readFileText(logFilePath(day));
    if (!content) return [];
    return parseFileContent(content).sort((a, b) => b.ts - a.ts);
}

/** Entries with ts > cursorTs, oldest-first, capped — for background upload. */
export async function collectEntriesAfterTs(cursorTs: number, maxEntries: number): Promise<KioskLogEntry[]> {
    const days = (await listLogDays()).sort();
    const pending: KioskLogEntry[] = [];

    for (const day of days) {
        const content = await readFileText(logFilePath(day));
        if (!content) continue;
        pending.push(...parseFileContent(content).filter((e) => e.ts > cursorTs));
    }

    return pending
        .sort((a, b) => a.ts - b.ts)
        .slice(0, maxEntries);
}

export async function pruneLogsOlderThan(retainDays: number): Promise<number> {
    const cutoff = cutoffDayKey(retainDays);
    let removed = 0;

    if (!isNativeFilesystem()) {
        for (const day of [...webDayBuffers.keys()]) {
            if (day < cutoff) {
                webDayBuffers.delete(day);
                removed++;
            }
        }
        return removed;
    }

    try {
        const result = await Filesystem.readdir({
            path: LOG_DIR,
            directory: Directory.Data,
        });
        for (const f of result.files) {
            const name = f.name ?? String(f);
            const day = parseDayFromFileName(name);
            if (day && day < cutoff) {
                await deleteFile(`${LOG_DIR}/${name}`);
                removed++;
            }
        }
    } catch {
        /* empty dir */
    }
    return removed;
}

export async function clearAllLogFiles(): Promise<void> {
    if (!isNativeFilesystem()) {
        webDayBuffers.clear();
        return;
    }
    try {
        const result = await Filesystem.readdir({
            path: LOG_DIR,
            directory: Directory.Data,
        });
        for (const f of result.files) {
            const name = f.name ?? String(f);
            await deleteFile(`${LOG_DIR}/${name}`);
        }
    } catch {
        /* ignore */
    }
}

export async function estimateLogStorageBytes(): Promise<number> {
    if (!isNativeFilesystem()) {
        let total = 0;
        for (const buf of webDayBuffers.values()) total += buf.length;
        return total;
    }
    let total = 0;
    try {
        const result = await Filesystem.readdir({
            path: LOG_DIR,
            directory: Directory.Data,
        });
        for (const f of result.files) {
            const name = f.name ?? String(f);
            try {
                const stat = await Filesystem.stat({
                    path: `${LOG_DIR}/${name}`,
                    directory: Directory.Data,
                });
                total += stat.size ?? 0;
            } catch {
                /* skip */
            }
        }
    } catch {
        /* empty */
    }
    return total;
}

/** One-time import from pre-filesystem localStorage buckets. */
export async function migrateLegacyLocalStorageLogs(): Promise<void> {
    try {
        const rawIndex = localStorage.getItem(LEGACY_INDEX_KEY);
        if (!rawIndex) return;

        const index = JSON.parse(rawIndex) as { days?: string[] };
        const days = Array.isArray(index.days) ? index.days : [];
        for (const day of days) {
            const raw = localStorage.getItem(`${LEGACY_DAY_PREFIX}${day}`);
            if (!raw) continue;
            let entries: KioskLogEntry[];
            try {
                entries = JSON.parse(raw) as KioskLogEntry[];
            } catch {
                continue;
            }
            if (!Array.isArray(entries) || entries.length === 0) continue;

            const lines = entries.map((e) => serializeLogEntry(e)).join('\n') + '\n';
            await appendFileText(logFilePath(day), lines);
            localStorage.removeItem(`${LEGACY_DAY_PREFIX}${day}`);
            localStorage.removeItem(`${LEGACY_DAY_PREFIX}${day}.gz.json`);
        }
        localStorage.removeItem(LEGACY_INDEX_KEY);
    } catch (e) {
        console.warn('[KioskLog] legacy migration failed:', e);
    }
}
