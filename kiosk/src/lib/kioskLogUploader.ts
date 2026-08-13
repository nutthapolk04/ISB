/**
 * Best-effort background uploader for the on-device event log (kioskLog.ts).
 * After a successful batch upload, advances the cursor only — log files stay
 * on device for technician review (90-day retention).
 */
import { collectKioskLogsAfterTs } from './kioskLog';
import { realApi } from '../api/realApi';

const CURSOR_KEY = 'kiosk-log-upload-cursor-ts';
const UPLOAD_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES_PER_UPLOAD = 500;

function readCursor(): number {
    try {
        const raw = localStorage.getItem(CURSOR_KEY);
        const n = raw ? Number(raw) : 0;
        return Number.isFinite(n) ? n : 0;
    } catch {
        return 0;
    }
}

function writeCursor(ts: number): void {
    try {
        localStorage.setItem(CURSOR_KEY, String(ts));
    } catch {
        /* cursor stuck — next upload may re-send duplicates; server tolerates */
    }
}

async function uploadPendingKioskLogs(): Promise<void> {
    try {
        const cursor = readCursor();
        const pending = await collectKioskLogsAfterTs(cursor, MAX_ENTRIES_PER_UPLOAD);
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

        const lastTs = pending[pending.length - 1].ts;
        writeCursor(lastTs);
    } catch {
        // Best-effort — next interval tick retries from the same cursor.
    }
}

let intervalId: number | null = null;

export function startKioskLogUploader(): void {
    if (intervalId !== null) return;
    void uploadPendingKioskLogs();
    intervalId = window.setInterval(() => {
        void uploadPendingKioskLogs();
    }, UPLOAD_INTERVAL_MS);
}
