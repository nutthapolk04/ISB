export type KioskLogLevel = 'info' | 'warn' | 'error';

export type KioskLogCategory =
    | 'system'
    | 'auth'
    | 'api'
    | 'bill'
    | 'cash'
    | 'qr'
    | 'pending';

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
