/**
 * Human-readable kiosk event messages for technicians on site.
 * Format: [d/M/yy HH:mm:ss Bangkok][member_id] : Action at KioskName
 */
import type { User, Wallet } from '../api/mockApi';
import { getKioskDeviceId, getKioskDeviceName } from './kioskLog';

const BANGKOK_TZ = 'Asia/Bangkok';

const bangkokFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TZ,
    day: 'numeric',
    month: 'numeric',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
});

export function formatBangkokLogTimestamp(date = new Date()): string {
    return bangkokFormatter.format(date);
}

/** e.g. 5000 → "5,000" */
export function formatThbAmount(amount: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount);
}

export function kioskLocationLabel(): string {
    return getKioskDeviceName() || getKioskDeviceId();
}

/** Best display id: PowerSchool external_id → card/student code → employee id. */
export function resolveMemberLogId(user: User | null | undefined, wallet?: Wallet | null): string {
    if (!user) return '—';
    const w = wallet ?? user.wallets[0];
    const id =
        user.externalId?.trim()
        || w?.externalId?.trim()
        || w?.cardId?.trim()
        || user.employeeId?.trim()
        || user.id?.trim();
    return id || '—';
}

export function memberLogData(user: User | null | undefined, wallet?: Wallet | null): Record<string, string> {
    const memberId = resolveMemberLogId(user, wallet);
    const w = wallet ?? user?.wallets[0];
    return {
        external_id: memberId === '—' ? '' : memberId,
        member_name: user?.name ?? '',
        wallet_id: w?.id ?? '',
    };
}

/** Build [timestamp][id] : action */
export function techLogMessage(action: string, memberId?: string | null): string {
    const ts = formatBangkokLogTimestamp();
    const id = memberId?.trim() || '—';
    return `[${ts}][${id}] : ${action}`;
}

export function techLogAtKiosk(action: string, memberId?: string | null): string {
    return techLogMessage(`${action} at ${kioskLocationLabel()}`, memberId);
}
