export const TECHNICIAN_SESSION_KEY = 'kiosk-technician-unlocked';

function kioskPasswordFromEnv(): string {
    return (import.meta.env.VITE_KIOSK_PASSWORD as string | undefined)?.trim() ?? '';
}

/** Technician console unlock — same password as the kiosk service account (VITE_KIOSK_PASSWORD). */
export function verifyTechnicianPassword(password: string): boolean {
    const expected = kioskPasswordFromEnv();
    return !!expected && password === expected;
}
