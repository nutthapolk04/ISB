import { describe, expect, test } from 'bun:test';
import {
    buildRecoveryReceiptData,
    buildRecoverySnapshot,
    RECOVERY_STAFF_MESSAGE_EN,
} from '../src/lib/recoveryReceipt';

const labels = {
    receiptTitle: 'Receipt',
    receiptType: 'Top-up',
    receiptRef: 'Reference',
    receiptTxId: 'Transaction No.',
    receiptPayerIsbId: 'Payer ISB ID',
    receiptReceiverIsbId: 'Receiver ISB ID',
    receiptPayer: 'Payer',
    receiptDevice: 'Machine',
    successDate: 'Date & Time',
    successMethod: 'Method',
    successAmount: 'Amount',
    receiptPoweredBy: 'System generated',
};

describe('recoveryReceipt', () => {
    test('buildRecoverySnapshot captures payment context', () => {
        const snapshot = buildRecoverySnapshot({
            method: 'CASH',
            ref: 'abc',
            payer_id: 'P1',
            receiver_id: 'R1',
            actual_amount: 100,
            target_amount: 200,
            device_name: 'Kiosk 1',
        });
        expect(snapshot.ref).toBe('abc');
        expect(snapshot.actual_amount).toBe(100);
        expect(snapshot.device_name).toBe('Kiosk 1');
    });

    test('buildRecoveryReceiptData omits balance and includes staff message', () => {
        const snapshot = buildRecoverySnapshot({
            method: 'CASH',
            ref: 'abc',
            payer_id: 'P1',
            receiver_id: 'R1',
            actual_amount: 100,
            target_amount: 200,
        });
        const receipt = buildRecoveryReceiptData(
            snapshot,
            labels,
            'Cash',
            (n) => n.toFixed(2),
            () => '2026-07-30',
        );
        expect(receipt.balanceLabel).toBe('');
        expect(receipt.balanceText).toBe('');
        expect(receipt.footerLines[0]).toBe(RECOVERY_STAFF_MESSAGE_EN);
        expect(receipt.rows.some((r) => r.label === 'Reference' && r.value === 'abc')).toBe(true);
        expect(receipt.rows.some((r) => r.label === 'Transaction No.' && r.value === '-')).toBe(true);
    });
});
