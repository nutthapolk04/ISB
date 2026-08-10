/**
 * Kiosk session hygiene — clear stale member state on boot/resume and block
 * phantom RFID scans right after the app becomes interactive.
 */
import type { Router } from 'vue-router';
import type { useKioskStore } from '../stores/kioskStore';

const RFID_BLOCK_MS = 2500;
let rfidBlockedUntil = 0;

export function blockRfidAfterBoot(): void {
    rfidBlockedUntil = Date.now() + RFID_BLOCK_MS;
}

export function isRfidAccepting(): boolean {
    return Date.now() >= rfidBlockedUntil;
}

type KioskStore = ReturnType<typeof useKioskStore>;

/** Drop any in-memory member session and return to welcome (unless technician). */
export function resetKioskSession(store: KioskStore, router: Router): void {
    const routeName = router.currentRoute.value.name;
    const onTechnician = routeName === 'technician';
    store.logout();
    if (!onTechnician && routeName !== 'welcome') {
        void router.replace('/');
    }
}
