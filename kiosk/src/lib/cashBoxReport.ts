import type { BillsCount } from './kioskAuditLog';
import type { ReceiptData, ReceiptRow } from './escpos';
import { KIOSK_RECEIPT_LOGO_URL } from './escpos';
import { formatAuditTimestamp } from './kioskAuditLog';
import { getCashBoxTotal } from './kioskCashBox';

export interface CashBoxReportLabels {
    title: string;
    typeLabel: string;
    device: string;
    dateTime: string;
    bill100: string;
    bill500: string;
    bill1000: string;
    countUnit: string;
    total: string;
    sinceClear: string;
    footer: string;
}

export interface CashBoxReportInput {
    bills: BillsCount;
    deviceName?: string;
    lastClearedAt?: string | null;
    clearedAt?: string;
    labels: CashBoxReportLabels;
    formatSinceClear?: (iso: string) => string;
}

export function buildCashBoxReportData(input: CashBoxReportInput): ReceiptData {
    const { bills, labels } = input;
    const total = getCashBoxTotal(bills);
    const reportTime = input.clearedAt ?? new Date().toISOString();

    const rows: ReceiptRow[] = [];
    if (input.deviceName) {
        rows.push({ label: labels.device, value: input.deviceName });
    }
    rows.push({ label: labels.dateTime, value: formatAuditTimestamp(new Date(reportTime)) });
    if (input.lastClearedAt && input.formatSinceClear) {
        rows.push({
            label: labels.sinceClear,
            value: input.formatSinceClear(input.lastClearedAt),
        });
    }
    rows.push({ label: labels.bill1000, value: `${bills[1000] ?? 0} ${labels.countUnit}` });
    rows.push({ label: labels.bill500, value: `${bills[500] ?? 0} ${labels.countUnit}` });
    rows.push({ label: labels.bill100, value: `${bills[100] ?? 0} ${labels.countUnit}` });

    return {
        logoUrl: KIOSK_RECEIPT_LOGO_URL,
        title: labels.title,
        typeLabel: labels.typeLabel,
        rows,
        amountLabel: labels.total,
        amountText: `฿${total.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
        balanceLabel: '',
        balanceText: '',
        footerLines: [labels.footer],
    };
}

export interface CashBoxSlipRow {
    label: string;
    value: string;
    tone?: 'brown' | 'purple' | 'orange' | 'default';
}

export function buildCashBoxSlipRows(
    bills: BillsCount,
    labels: Pick<CashBoxReportLabels, 'bill100' | 'bill500' | 'bill1000' | 'countUnit'>,
): CashBoxSlipRow[] {
    return [
        { label: labels.bill1000, value: `${bills[1000] ?? 0} ${labels.countUnit}`, tone: 'brown' },
        { label: labels.bill500, value: `${bills[500] ?? 0} ${labels.countUnit}`, tone: 'purple' },
        { label: labels.bill100, value: `${bills[100] ?? 0} ${labels.countUnit}`, tone: 'orange' },
    ];
}
