/**
 * Best-effort background uploader for the on-device event log (kioskLog.ts)
 * — sends entries to the backend so an admin can browse them remotely via
 * the Kiosk Report (see backend-bun/src/services/kiosk_service.ts::ingestKioskLogs
 * and admin_reports_service.ts::kioskLogReport). Never touches the local
 * log itself — kioskLog.ts's own 14-day/5MB retention is unaffected by
 * whether upload succeeds.
 *
 * Runs on an interval, not per-entry: logging happens far too often (every
 * API call, every bill-acceptor event) to network-round-trip each one
 * individually without risking real UX-affecting network contention on a
 * kiosk terminal. A failed upload is silently retried next tick — it must
 * never surface an error to the cashier/parent-facing UI.
 */
import { listKioskLogDays, getKioskLogsForDay, type KioskLogEntry } from './kioskLog';
import { realApi } from '../api/realApi';

const CURSOR_KEY = 'kiosk-log-upload-cursor-ts';
const UPLOAD_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES_PER_UPLOAD = 500;

function readCursor(): number {
    const raw = localStorage.getItem(CURSOR_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
}

function writeCursor(ts: number): void {
    localStorage.setItem(CURSOR_KEY, String(ts));
}

/** Entries newer than the cursor, oldest-first, capped — walks days
 * newest-first (cheap early exit once a whole day is at/before the cursor)
 * then re-sorts the collected slice ascending for a stable upload order. */
function collectPendingEntries(cursor: number): KioskLogEntry[] {
    const pending: KioskLogEntry[] = [];
    for (const day of listKioskLogDays()) {
        const dayEntries = getKioskLogsForDay(day); // newest-first
        const newer = dayEntries.filter((e) => e.ts > cursor);
        pending.push(...newer);
        if (newer.length < dayEntries.length) break; // hit entries already uploaded — earlier days are too
        if (pending.length >= MAX_ENTRIES_PER_UPLOAD) break;
    }
    return pending
        .sort((a, b) => a.ts - b.ts)
        .slice(-MAX_ENTRIES_PER_UPLOAD);
}

async function uploadPendingKioskLogs(): Promise<void> {
    try {
        const cursor = readCursor();
        const pending = collectPendingEntries(cursor);
        if (pending.length === 0) return;

        await realApi.uploadKioskLogs(
            pending.map((e) => ({
                ts: e.iso,
                level: e.level,
                category: e.category,
                message: e.message,
                data: e.data,
            })),
        );
        writeCursor(pending[pending.length - 1].ts);
    } catch {
        // Best-effort — next interval tick retries from the same cursor.
    }
}

let intervalId: number | null = null;

/** Starts the periodic uploader. Idempotent — calling it twice (e.g. a hot
 * reload during dev) doesn't stack intervals. */
export function startKioskLogUploader(): void {
    if (intervalId !== null) return;
    void uploadPendingKioskLogs();
    intervalId = window.setInterval(() => {
        void uploadPendingKioskLogs();
    }, UPLOAD_INTERVAL_MS);
}
