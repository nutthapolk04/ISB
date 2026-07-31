/** Kiosk API service account username — baked per device at build time. */
export function getKioskServiceUsername(): string {
    const username = (import.meta.env.VITE_KIOSK_USERNAME as string | undefined)?.trim();
    if (!username) {
        throw new Error('Set VITE_KIOSK_USERNAME in .env');
    }
    return username;
}
