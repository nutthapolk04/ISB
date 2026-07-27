const STORAGE_KEY = 'kiosk-technician-password';
const MIN_LENGTH = 4;

function envDefaultPassword(): string {
    return (import.meta.env.VITE_KIOSK_PASSWORD as string | undefined)?.trim() ?? '';
}

function readStoredOverride(): string | null {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        return v && v.trim() ? v : null;
    } catch {
        return null;
    }
}

/** Effective technician console password — device override or build-time default. */
export function getTechnicianPassword(): string {
    return readStoredOverride() ?? envDefaultPassword();
}

export function verifyTechnicianPassword(password: string): boolean {
    const expected = getTechnicianPassword();
    return !!expected && password === expected;
}

export type ChangePasswordError =
    | 'wrong_current'
    | 'too_short'
    | 'mismatch'
    | 'same_as_current'
    | 'storage_failed';

export function changeTechnicianPassword(
    current: string,
    next: string,
    confirm: string,
): { ok: true } | { ok: false; error: ChangePasswordError } {
    if (!verifyTechnicianPassword(current)) {
        return { ok: false, error: 'wrong_current' };
    }
    if (next.length < MIN_LENGTH) {
        return { ok: false, error: 'too_short' };
    }
    if (next !== confirm) {
        return { ok: false, error: 'mismatch' };
    }
    if (next === current) {
        return { ok: false, error: 'same_as_current' };
    }
    try {
        localStorage.setItem(STORAGE_KEY, next);
        return { ok: true };
    } catch {
        return { ok: false, error: 'storage_failed' };
    }
}

export { MIN_LENGTH as TECHNICIAN_PASSWORD_MIN_LENGTH, STORAGE_KEY as TECHNICIAN_PASSWORD_STORAGE_KEY };
