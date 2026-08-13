export type KioskLogLevel = 'info' | 'warn' | 'error';

/** Audit action types — also stored as `category` for upload/filtering. */
export type KioskLogCategory =
    | 'PING'
    | 'TAP'
    | 'TOPUP'
    | 'CLEAR-CASH-BOX'
    | 'LOCK'
    | 'UNLOCK'
    | 'system';

export interface KioskLogEntry {
    ts: number;
    iso: string;
    level: KioskLogLevel;
    category: KioskLogCategory;
    message: string;
    device_id: string;
    device_name: string;
    data?: Record<string, unknown>;
}
