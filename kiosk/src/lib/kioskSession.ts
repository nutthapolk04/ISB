/**
 * Kiosk session hygiene — clear stale member state on boot/resume and block
 * phantom RFID scans right after the app becomes interactive.
 */
import type { Router } from 'vue-router';
import type { useKioskStore } from '../stores/kioskStore';
import { isOutOfService } from './kioskOutOfService';

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
    const routePath = router.currentRoute.value.path;
    const onTechnician = routePath.startsWith('/technician');
    store.logout();
    if (onTechnician) return;
    if (isOutOfService()) {
        if (routePath !== '/out-of-service') {
            void router.replace('/out-of-service');
        }
        return;
    }
    if (routePath !== '/') {
        void router.replace('/');
    }
}
