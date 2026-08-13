/**
 * Physical cash-box counter — persists stacked bills since last technician clear.
 * Dual-write: in-memory + localStorage (sync) + app data file (async).
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { readonly, ref } from 'vue';
import {
    auditClearCashBox,
    type BillDenom,
    type BillsCount,
} from './kioskAuditLog';

const STORAGE_KEY = 'kiosk-cash-box-state';
const FILE_DIR = 'kiosk-cash-box';
const FILE_PATH = `${FILE_DIR}/state.json`;

const BILL_DENOMS: BillDenom[] = [1000, 500, 100];

export interface CashBoxState {
    counts: BillsCount;
    lastClearedAt: string | null;
    updatedAt: string;
}

const cashBoxState = ref<CashBoxState>(emptyCashBoxState());
let writeChain = Promise.resolve();
let webFileBuffer: string | null = null;

function isNativeFilesystem(): boolean {
    return Capacitor.isNativePlatform();
}

function emptyCashBoxState(): CashBoxState {
    return {
        counts: {},
        lastClearedAt: null,
        updatedAt: new Date().toISOString(),
    };
}

function normalizeCounts(counts: BillsCount): BillsCount {
    const normalized: BillsCount = {};
    for (const denom of BILL_DENOMS) {
        const n = counts[denom] ?? 0;
        if (n > 0) normalized[denom] = n;
    }
    return normalized;
}

function parseState(raw: string): CashBoxState | null {
    try {
        const parsed = JSON.parse(raw) as Partial<CashBoxState>;
        if (!parsed || typeof parsed !== 'object') return null;
        return {
            counts: normalizeCounts((parsed.counts ?? {}) as BillsCount),
            lastClearedAt: typeof parsed.lastClearedAt === 'string' ? parsed.lastClearedAt : null,
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        };
    } catch {
        return null;
    }
}

function readLocalStorageState(): CashBoxState | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return parseState(raw);
    } catch {
        return null;
    }
}

function writeLocalStorageState(state: CashBoxState): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        /* memory ref still holds state */
    }
}

async function ensureCashBoxDirectory(): Promise<void> {
    if (!isNativeFilesystem()) return;
    try {
        await Filesystem.mkdir({
            path: FILE_DIR,
            directory: Directory.Data,
            recursive: true,
        });
    } catch {
        /* already exists */
    }
}

async function readFileState(): Promise<CashBoxState | null> {
    if (!isNativeFilesystem()) {
        if (!webFileBuffer) return null;
        return parseState(webFileBuffer);
    }
    try {
        const result = await Filesystem.readFile({
            path: FILE_PATH,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
        const data = typeof result.data === 'string' ? result.data : '';
        if (!data) return null;
        return parseState(data);
    } catch {
        return null;
    }
}

async function writeFileState(state: CashBoxState): Promise<void> {
    const payload = JSON.stringify(state);
    if (!isNativeFilesystem()) {
        webFileBuffer = payload;
        return;
    }
    await ensureCashBoxDirectory();
    await Filesystem.writeFile({
        path: FILE_PATH,
        data: payload,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
    });
}

function applyState(state: CashBoxState): void {
    cashBoxState.value = {
        counts: normalizeCounts(state.counts),
        lastClearedAt: state.lastClearedAt,
        updatedAt: state.updatedAt,
    };
}

function enqueuePersist(state: CashBoxState): void {
    writeLocalStorageState(state);
    writeChain = writeChain
        .then(() => writeFileState(state))
        .catch((e) => {
            console.warn('[CashBox] file write failed:', e);
        });
}

export function getCashBoxTotal(counts: BillsCount): number {
    return BILL_DENOMS.reduce((sum, denom) => sum + (counts[denom] ?? 0) * denom, 0);
}

export function useCashBoxState() {
    return readonly(cashBoxState);
}

export async function initKioskCashBox(): Promise<void> {
    const fromFile = await readFileState();
    const fromLs = readLocalStorageState();
    const state = fromFile ?? fromLs ?? emptyCashBoxState();
    applyState(state);
    writeLocalStorageState(state);
    enqueuePersist(state);
}

export function recordStackedBill(denom: BillDenom): void {
    const next: CashBoxState = {
        ...cashBoxState.value,
        counts: {
            ...cashBoxState.value.counts,
            [denom]: (cashBoxState.value.counts[denom] ?? 0) + 1,
        },
        updatedAt: new Date().toISOString(),
    };
    applyState(next);
    enqueuePersist(next);
}

export interface CashBoxClearSnapshot {
    amount: number;
    bills: BillsCount;
    clearedAt: string;
}

/** Reset counter and write CLEAR-CASH-BOX audit line. Call after report is shown/printed. */
export function commitCashBoxClear(snapshot: CashBoxClearSnapshot): void {
    auditClearCashBox(snapshot.amount, snapshot.bills);
    const next: CashBoxState = {
        counts: {},
        lastClearedAt: snapshot.clearedAt,
        updatedAt: snapshot.clearedAt,
    };
    applyState(next);
    enqueuePersist(next);
}

export function buildCashBoxClearSnapshot(): CashBoxClearSnapshot {
    const bills = normalizeCounts(cashBoxState.value.counts);
    return {
        amount: getCashBoxTotal(bills),
        bills,
        clearedAt: new Date().toISOString(),
    };
}

/** @internal — tests only */
export function __test__resetCashBox(state: CashBoxState | null = null): void {
    webFileBuffer = null;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* ignore */
    }
    applyState(state ?? emptyCashBoxState());
}
