import type { ReceiptRow, TopupReceiptData } from './escpos';
import { KIOSK_RECEIPT_LOGO_URL } from './escpos';
import type { TopupMethod } from './kioskAuditLog';

export const RECOVERY_RECEIPT_DISPLAY_MS = 10_000;
export const RECOVERY_STAFF_MESSAGE_EN =
    'Please bring this receipt to Ed-Tech for assistance.';

export interface RecoveryTopupSnapshot {
    method: TopupMethod;
    ref: string;
    payer_id: string;
    receiver_id: string;
    payer_name_masked?: string;
    actual_amount: number;
    target_amount: number;
    transaction_id?: number | null;
    recorded_at: string;
    device_name?: string;
}

export interface RecoveryReceiptLabels {
    receiptTitle: string;
    receiptType: string;
    receiptRef: string;
    receiptTxId: string;
    receiptPayerIsbId: string;
    receiptReceiverIsbId: string;
    receiptPayer: string;
    receiptDevice: string;
    successDate: string;
    successMethod: string;
    successAmount: string;
    receiptPoweredBy: string;
}

export function buildRecoverySnapshot(params: {
    method: TopupMethod;
    ref: string;
    payer_id: string;
    receiver_id: string;
    payer_name_masked?: string;
    actual_amount: number;
    target_amount: number;
    device_name?: string;
    recorded_at?: string;
}): RecoveryTopupSnapshot {
    return {
        method: params.method,
        ref: params.ref,
        payer_id: params.payer_id,
        receiver_id: params.receiver_id,
        payer_name_masked: params.payer_name_masked,
        actual_amount: params.actual_amount,
        target_amount: params.target_amount,
        transaction_id: null,
        recorded_at: params.recorded_at ?? new Date().toISOString(),
        device_name: params.device_name,
    };
}

export function buildRecoveryReceiptData(
    snapshot: RecoveryTopupSnapshot,
    labels: RecoveryReceiptLabels,
    methodLabel: string,
    formatCurrency: (amount: number) => string,
    formatDate: (iso: string) => string,
    schoolName?: string,
): TopupReceiptData {
    const rows: ReceiptRow[] = [
        { label: labels.receiptRef, value: snapshot.ref },
        { label: labels.receiptPayerIsbId, value: snapshot.payer_id },
        { label: labels.receiptReceiverIsbId, value: snapshot.receiver_id },
        {
            label: labels.receiptTxId,
            value: snapshot.transaction_id != null ? String(snapshot.transaction_id) : '-',
        },
        { label: labels.successDate, value: formatDate(snapshot.recorded_at) },
    ];

    if (snapshot.device_name) {
        rows.push({ label: labels.receiptDevice, value: snapshot.device_name });
    }
    if (snapshot.payer_name_masked) {
        rows.push({ label: labels.receiptPayer, value: snapshot.payer_name_masked });
    }
    rows.push({ label: labels.successMethod, value: methodLabel });

    return {
        schoolName,
        logoUrl: KIOSK_RECEIPT_LOGO_URL,
        title: labels.receiptTitle,
        typeLabel: labels.receiptType,
        rows,
        amountLabel: labels.successAmount,
        amountText: `+฿${formatCurrency(snapshot.actual_amount)}`,
        balanceLabel: '',
        balanceText: '',
        footerLines: [RECOVERY_STAFF_MESSAGE_EN, labels.receiptPoweredBy],
    };
}
