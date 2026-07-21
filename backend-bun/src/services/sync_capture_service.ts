/**
 * Captures every raw ISB sync batch (families/staffs/departments) to disk,
 * grouped into "rounds", so an admin can later preview and re-run one via
 * Manual Sync (see admin_sync_controls_service.ts) — without depending on
 * hand-authored fixture files (the old powerschool_sync.ts::runSync() mock
 * engine, now removed).
 *
 * Round grouping: ISB re-syncs its FULL dataset every hour, chunked into
 * several independent batch calls (confirmed 2026-07, see
 * family_sweep_service.ts's own doc comment) — arbitrary order, no
 * batch-count signal. Consecutive batches on the SAME channel less than
 * ROUND_GAP_MS apart are treated as the same round; a bigger gap starts a
 * new one. Each channel (families/staffs/departments) tracks its own rounds
 * independently — they don't run on a shared schedule.
 *
 * Deliberately does NOT delete a round just because a newer one started —
 * that's a separate, simpler retention policy (pruneOldRounds, a fixed
 * count per channel) so a bug in round-detection can never silently destroy
 * capture history. An admin can browse and Manual-Sync ANY retained round,
 * not just the latest.
 *
 * Every write here is best-effort — a capture failure must NEVER block or
 * fail a real ISB sync request.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@/logger";

export type SyncChannel = "families" | "staffs" | "departments";

const CAPTURE_ROOT = path.join(process.cwd(), "data", "sync_captures");
const ROUND_GAP_MS = 60 * 60 * 1000; // 1 hour
const MAX_ROUNDS_PER_CHANNEL = 20;

const CHANNEL_ARRAY_KEY: Record<SyncChannel, string> = {
    families: "families",
    staffs: "staffs",
    departments: "departments",
};

function channelDir(channel: SyncChannel): string {
    return path.join(CAPTURE_ROOT, channel);
}

function newRoundId(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    // Sorts correctly as a plain string — kept purely so listRoundDirs()
    // doesn't need to parse anything to get chronological order.
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

async function listRoundDirs(channel: SyncChannel): Promise<string[]> {
    try {
        const entries = await readdir(channelDir(channel), { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch {
        return [];
    }
}

async function batchFilesOf(roundPath: string): Promise<string[]> {
    try {
        return (await readdir(roundPath)).filter((f) => f.endsWith(".json")).sort();
    } catch {
        return [];
    }
}

async function latestMtimeMs(roundPath: string, files: string[]): Promise<number | null> {
    if (files.length === 0) return null;
    let latest = 0;
    for (const f of files) {
        const s = await stat(path.join(roundPath, f));
        if (s.mtimeMs > latest) latest = s.mtimeMs;
    }
    return latest;
}

/** Writes the raw batch payload to disk. Never throws. */
export async function captureSyncBatch(channel: SyncChannel, payload: unknown): Promise<void> {
    try {
        const dir = channelDir(channel);
        await mkdir(dir, { recursive: true });
        const rounds = await listRoundDirs(channel);
        const latestRound = rounds[rounds.length - 1];
        const now = Date.now();

        let roundId: string;
        let nextBatchIndex: number;
        if (latestRound) {
            const roundPath = path.join(dir, latestRound);
            const files = await batchFilesOf(roundPath);
            const lastMtime = await latestMtimeMs(roundPath, files);
            if (lastMtime !== null && now - lastMtime <= ROUND_GAP_MS) {
                roundId = latestRound;
                nextBatchIndex = files.length + 1;
            } else {
                roundId = newRoundId(now);
                nextBatchIndex = 1;
            }
        } else {
            roundId = newRoundId(now);
            nextBatchIndex = 1;
        }

        const roundPath = path.join(dir, roundId);
        await mkdir(roundPath, { recursive: true });
        const fileName = `batch_${String(nextBatchIndex).padStart(3, "0")}.json`;
        await writeFile(path.join(roundPath, fileName), JSON.stringify(payload, null, 2), "utf-8");

        await pruneOldRounds(channel);
    } catch (e) {
        logger.warn(`[sync_capture] failed to capture ${channel} batch (non-fatal)`, e as Error);
    }
}

async function pruneOldRounds(channel: SyncChannel): Promise<void> {
    const rounds = await listRoundDirs(channel);
    if (rounds.length <= MAX_ROUNDS_PER_CHANNEL) return;
    const toDelete = rounds.slice(0, rounds.length - MAX_ROUNDS_PER_CHANNEL);
    for (const r of toDelete) {
        await rm(path.join(channelDir(channel), r), { recursive: true, force: true }).catch(() => { });
    }
}

// ── Read side (Admin Manual Sync UI) ────────────────────────────────────────

export interface RoundSummary {
    roundId: string;
    batchCount: number;
    startedAt: string | null;
    lastWriteAt: string | null;
    recordCount: number;
}

async function countRecords(channel: SyncChannel, roundPath: string, files: string[]): Promise<number> {
    const key = CHANNEL_ARRAY_KEY[channel];
    let total = 0;
    for (const f of files) {
        try {
            const raw = JSON.parse(await readFile(path.join(roundPath, f), "utf-8"));
            const arr = raw?.[key];
            if (Array.isArray(arr)) total += arr.length;
        } catch {
            // corrupt/partial file — skip counting it, still shows up via batchCount
        }
    }
    return total;
}

export async function listRounds(channel: SyncChannel): Promise<RoundSummary[]> {
    const rounds = await listRoundDirs(channel);
    const out: RoundSummary[] = [];
    for (const roundId of rounds.slice().reverse()) { // newest first
        const roundPath = path.join(channelDir(channel), roundId);
        const files = await batchFilesOf(roundPath);
        let startedAt: number | null = null;
        let lastWriteAt: number | null = null;
        for (const f of files) {
            const s = await stat(path.join(roundPath, f));
            if (startedAt === null || s.mtimeMs < startedAt) startedAt = s.mtimeMs;
            if (lastWriteAt === null || s.mtimeMs > lastWriteAt) lastWriteAt = s.mtimeMs;
        }
        out.push({
            roundId,
            batchCount: files.length,
            startedAt: startedAt !== null ? new Date(startedAt).toISOString() : null,
            lastWriteAt: lastWriteAt !== null ? new Date(lastWriteAt).toISOString() : null,
            recordCount: await countRecords(channel, roundPath, files),
        });
    }
    return out;
}

/** All records across every batch file in a round, concatenated in file
 * order — this is both what the preview shows and what Manual Sync replays. */
export async function loadRoundRecords(channel: SyncChannel, roundId: string): Promise<unknown[]> {
    const roundPath = path.join(channelDir(channel), roundId);
    const files = await batchFilesOf(roundPath);
    if (files.length === 0) {
        const err = new Error(`No captured batches found for ${channel}/${roundId}`);
        (err as { status?: number }).status = 404;
        throw err;
    }
    const key = CHANNEL_ARRAY_KEY[channel];
    const records: unknown[] = [];
    for (const f of files) {
        const raw = JSON.parse(await readFile(path.join(roundPath, f), "utf-8"));
        const arr = raw?.[key];
        if (Array.isArray(arr)) records.push(...arr);
    }
    return records;
}
