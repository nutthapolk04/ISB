export interface ReceiptItem {
    productCode: string;
    productName: string;
    quantity: number;
    price: number;
    isBundle?: boolean;
    bundleId?: number | null;
    bundleCode?: string | null;
}

export interface ReceiptPayer {
    type: "customer" | "user" | "department" | "unknown";
    label: string;
    id?: number;
}

export interface Receipt {
    id: string;
    date: string;
    items: ReceiptItem[];
    total: number;
    // Backend payment_method enum: wallet | card_tap | cash | edc | credit_card |
    // debit_card | department | bank_transfer | other (declared loose here to
    // accept any backend value without breaking the type-check).
    paymentMethod: string;
    studentId?: string;
    studentName?: string;
    payer?: ReceiptPayer;
    edcMaskedCard?: string | null;
}

export interface PosReceipt {
    id: number;
    receipt_number: string;
    transaction_date: string;
    payer_label: string | null;
    payer_kind: string | null;
    total: number;
    payment_method: string;
    status: string;
    shop_id: string | null;
}

export interface ReturnRequest {
    id: number;
    receiptId: string;
    productCode?: string;
    productName: string;
    bundleId?: number | null;
    quantity: number;
    returnQuantity: number;
    reason: string;
    status: "pending" | "approved" | "rejected";
    date: string;
    priceType: "internal" | "normal";
    voidStatus?: "active" | "voided";
    returnStatus?: "no-return" | "partial-return" | "full-return";
}

export type ReturnMode = "with-receipt" | "without-receipt";

export interface NoReceiptItem {
    productCode: string;
    productName: string;
    unitPrice: number;
    returnQuantity: number;
    shopId: string;
}

export interface ReturnResult {
    refundAmount: number;
    refundMethod: string;
    refundedTo?: { type: string; label: string; balanceAfter?: number; maskedCard?: string };
    receiptId: string;
    receiptDate: string;
    payerLabel: string;
    returnedItems: Array<{ productCode: string; productName: string; returnQty: number; unitPrice: number }>;
    returnedAt: string;
    reason: string;
}

export interface SelectedItemEntry {
    selected: boolean;
    returnQty: number;
    productCode: string;
    bundleId: number | null;
}

export type SelectedItemsMap = { [key: string]: SelectedItemEntry };

export interface ExchangeItemEntry {
    productCode: string;
    quantity: number;
}

export type ExchangeItemsMap = { [key: string]: ExchangeItemEntry };
