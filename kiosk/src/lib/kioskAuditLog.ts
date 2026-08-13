/**
 * Structured kiosk audit log lines — single format for on-device files and server upload.
 */
import { logKioskEvent } from './kioskLog';
import type { KioskLogLevel } from './kioskLogTypes';

export type AuditAction = 'PING' | 'TAP' | 'TOPUP' | 'CLEAR-CASH-BOX' | 'LOCK' | 'UNLOCK';

export type TopupMethod = 'CASH' | 'QR';
export type TopupStatus = 'begin' | 'success' | 'failed' | 'cancelled' | 'timeout';

export type BillDenom = 1000 | 500 | 100;
export type BillsCount = Partial<Record<BillDenom, number>>;

const BANGKOK_TZ = 'Asia/Bangkok';
const REASON_MAX = 200;
const BILL_DENOMS: BillDenom[] = [1000, 500, 100];

const bangkokDateTimeFormatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
});

/** Bangkok wall clock without offset — logs are understood to be Thai time. */
export function formatAuditTimestamp(date = new Date()): string {
    return bangkokDateTimeFormatter.format(date).replace('T', ' ');
}

function escapeReason(reason: string): string {
    const trimmed = reason.trim().slice(0, REASON_MAX).replace(/"/g, '\\"');
    return `"${trimmed}"`;
}

function formatFieldValue(value: string | number | boolean): string {
    if (typeof value === 'string') {
        if (/^[A-Za-z0-9._-]+$/.test(value)) return value;
        return escapeReason(value);
    }
    return String(value);
}

export function formatBillsField(counts: BillsCount): string {
    const parts: string[] = [];
    for (const denom of BILL_DENOMS) {
        const n = counts[denom] ?? 0;
        if (n > 0) parts.push(`${denom}=${n}`);
    }
    return parts.join(',');
}

export function billsFromStackedAmounts(amounts: number[]): BillsCount {
    const counts: BillsCount = {};
    for (const amount of amounts) {
        if (amount === 1000 || amount === 500 || amount === 100) {
            counts[amount] = (counts[amount] ?? 0) + 1;
        }
    }
    return counts;
}

function buildAuditLine(
    action: AuditAction,
    fields: Record<string, string | number | boolean | undefined>,
    trailing?: string[],
): string {
    const ts = formatAuditTimestamp();
    const parts: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined || value === '') continue;
        parts.push(`${key}=${formatFieldValue(value)}`);
    }
    if (trailing?.length) parts.push(...trailing);
    return `${ts} [${action}] ${parts.join(', ')}`;
}

function writeAudit(
    action: AuditAction,
    level: KioskLogLevel,
    fields: Record<string, string | number | boolean | undefined>,
    trailing?: string[],
    data?: Record<string, unknown>,
): void {
    const message = buildAuditLine(action, fields, trailing);
    logKioskEvent(action, level, message, { action, ...fields, ...data });
}

export function auditPingFailed(error?: string): void {
    writeAudit('PING', 'error', {
        status: 'failed',
        ...(error ? { reason: error.slice(0, REASON_MAX) } : {}),
    });
}

export function auditPingRecovered(): void {
    writeAudit('PING', 'info', { status: 'recovered' });
}

export function auditTap(isbId: string): void {
    writeAudit('TAP', 'info', { isb_id: isbId });
}

export interface TopupBeginParams {
    ref: string;
    method: TopupMethod;
    payer_id: string;
    receiver_id: string;
    target_amount: number;
}

export function auditTopupBegin(params: TopupBeginParams): void {
    writeAudit('TOPUP', 'info', {
        ref: params.ref,
        method: params.method,
        payer_id: params.payer_id,
        receiver_id: params.receiver_id,
        target_amount: params.target_amount,
        status: 'begin',
    });
}

export interface TopupEndParams {
    ref: string;
    method: TopupMethod;
    payer_id: string;
    receiver_id: string;
    target_amount: number;
    actual_amount: number;
    status: TopupStatus;
    bills?: BillsCount;
    transaction_id?: number;
    reason?: string;
    retry?: boolean;
}

export function auditTopupEnd(params: TopupEndParams): void {
    const level: KioskLogLevel =
        params.status === 'failed' ? 'error'
            : params.status === 'cancelled' || params.status === 'timeout' ? 'warn'
                : 'info';

    const trailing: string[] = [];
    const billsStr = params.bills ? formatBillsField(params.bills) : '';
    if (billsStr) trailing.push(billsStr);
    if (params.transaction_id != null) trailing.push(`transaction_id=${params.transaction_id}`);
    if (params.retry) trailing.push('retry=true');
    if (params.reason) trailing.push(`reason=${escapeReason(params.reason)}`);

    const message = buildAuditLine('TOPUP', {
        ref: params.ref,
        method: params.method,
        payer_id: params.payer_id,
        receiver_id: params.receiver_id,
        target_amount: params.target_amount,
        actual_amount: params.actual_amount,
        status: params.status,
    }, trailing);

    logKioskEvent('TOPUP', level, message, {
        action: 'TOPUP',
        ref: params.ref,
        method: params.method,
        payer_id: params.payer_id,
        receiver_id: params.receiver_id,
        target_amount: params.target_amount,
        actual_amount: params.actual_amount,
        status: params.status,
        bills: params.bills,
        transaction_id: params.transaction_id,
        retry: params.retry ?? false,
        reason: params.reason,
    });
}

export interface LockAuditParams {
    ref?: string;
    method?: TopupMethod;
    payer_id?: string;
    receiver_id?: string;
    actual_amount?: number;
    /** Set on UNLOCK after OOS — cash was taken but top-up did not credit. */
    unsuccessful_transaction?: boolean;
}

export function auditLock(params: LockAuditParams = {}): void {
    writeAudit('LOCK', 'info', { ...params });
}

export function auditUnlock(params: LockAuditParams = {}): void {
    writeAudit('UNLOCK', 'info', { ...params });
}

export function auditClearCashBox(amount: number, bills: BillsCount): void {
    const billsStr = formatBillsField(bills);
    const message = buildAuditLine('CLEAR-CASH-BOX', { amount }, billsStr ? [billsStr] : undefined);
    logKioskEvent('CLEAR-CASH-BOX', 'info', message, { action: 'CLEAR-CASH-BOX', amount, bills });
}

/** @internal — exposed for unit tests */
export const __test__ = {
    buildAuditLine,
    escapeReason,
    formatBillsField,
};
