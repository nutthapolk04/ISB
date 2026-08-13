import { describe, expect, test } from 'bun:test';
import {
    buildCashBoxReportData,
    buildCashBoxSlipRows,
} from '../src/lib/cashBoxReport';

const labels = {
    title: 'Cash Box Report',
    typeLabel: 'Cash Box',
    device: 'Machine',
    dateTime: 'Date & Time',
    bill100: '฿100',
    bill500: '฿500',
    bill1000: '฿1,000',
    countUnit: 'notes',
    total: 'Total',
    sinceClear: 'Since last clear',
    footer: 'System generated',
};

describe('cashBoxReport', () => {
    test('buildCashBoxReportData includes denomination rows and total', () => {
        const data = buildCashBoxReportData({
            bills: { 1000: 2, 500: 1, 100: 3 },
            deviceName: 'Kiosk A',
            labels,
        });
        expect(data.balanceText).toBe('');
        expect(data.amountText).toBe('฿2,800');
        expect(data.rows.some((r) => r.label === '฿1,000' && r.value === '2 notes')).toBe(true);
    });

    test('buildCashBoxSlipRows assigns bill tones', () => {
        const rows = buildCashBoxSlipRows({ 1000: 1, 500: 2, 100: 3 }, labels);
        expect(rows).toHaveLength(3);
        expect(rows[0].tone).toBe('brown');
        expect(rows[1].tone).toBe('purple');
        expect(rows[2].tone).toBe('orange');
    });
});
