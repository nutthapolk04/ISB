import { computed, ref, type WritableComputedRef } from 'vue';

const STORAGE_KEY = 'kiosk-debug-mode';

const DEFAULT_MIN_TOPUP = 100;
const DEBUG_MIN_TOPUP = 1;

function readStored(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

/** Reactive flag — stays in sync when toggled from Technician View. */
const debugMode = ref(readStored());

export function isKioskDebugMode(): boolean {
    return debugMode.value;
}

export function setKioskDebugMode(enabled: boolean): void {
    debugMode.value = enabled;
    try {
        localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch {
        // ignore quota / private-mode failures
    }
}

export function useKioskDebugMode(): WritableComputedRef<boolean> {
    return computed({
        get: () => debugMode.value,
        set: (v: boolean) => setKioskDebugMode(v),
    });
}

/** Top-up floor in THB — 1 when debug mode is on (QR testing). */
export function getMinTopupAmount(): number {
    return debugMode.value ? DEBUG_MIN_TOPUP : DEFAULT_MIN_TOPUP;
}

export { DEFAULT_MIN_TOPUP, DEBUG_MIN_TOPUP, STORAGE_KEY as DEBUG_MODE_STORAGE_KEY };
