/**
 * Receipt-domain TypeScript types.
 * Mirrors backend models in `backend/app/models/receipt.py` and `credit_note.py`.
 */

// ---------------------------------------------------------------------------
// Enums (matching backend SQLAlchemy enums)
// ---------------------------------------------------------------------------

export type TransactionMode = "sale" | "internal_issue";
export type ReceiptStatus = "active" | "voided";
export type PaymentMethodType =
  | "cash"
  | "credit_card"
  | "debit_card"
  | "wallet"
  | "bank_transfer"
  | "other";
export type RefundType = "product" | "wallet" | "cash";
export type CreditNoteStatus = "pending" | "approved" | "rejected" | "completed";

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

/** Snapshot of selected menu options on a receipt line (canteen POS). */
export interface ReceiptOptionsSnapshot {
  options_total: number;
  groups: Array<{
    group_id: number;
    name: string;
    selection_type: "single" | "multi" | "quantity";
    options: Array<{
      option_id: number;
      name: string;
      price_delta: number;
      quantity: number;
    }>;
  }>;
}

export interface ReceiptItem {
  id: number;
  receipt_id: number;
  product_variant_id: number;
  quantity: number;
  unit_price: number;
  discount: number;
  line_total: number;
  /** Present for canteen POS lines that included menu customisations. */
  options?: ReceiptOptionsSnapshot | null;
  created_at: string;
  /** Joined from ProductVariant when expanding */
  product_variant?: {
    sku: string;
    variant_name: string;
    barcode?: string | null;
  };
}

export interface Receipt {
  id: number;
  receipt_number: string;
  transaction_date: string;
  transaction_mode: TransactionMode;
  customer_type_id?: number | null;
  customer_id?: number | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payment_method: PaymentMethodType;
  status: ReceiptStatus;
  terminal_id?: string | null;
  notes?: string | null;
  created_at: string;
  created_by: number;
  voided_at?: string | null;
  voided_by?: number | null;
  voided_reason?: string | null;
  items: ReceiptItem[];
}

// ---------------------------------------------------------------------------
// Checkout payload
// ---------------------------------------------------------------------------

export interface CheckoutItemPayload {
  product_variant_id: number;
  quantity: number;
  unit_price: number;
  discount?: number;
}

export interface CheckoutPayload {
  transaction_mode: TransactionMode;
  payment_method: PaymentMethodType;
  customer_id?: number;
  items: CheckoutItemPayload[];
  notes?: string;
}

// ---------------------------------------------------------------------------
// Credit Note
// ---------------------------------------------------------------------------

export interface CreditNote {
  id: number;
  credit_note_number: string;
  original_receipt_id?: number | null;
  credit_date: string;
  total_credit_amount: number;
  refund_type: RefundType;
  status: CreditNoteStatus;
  reason?: string | null;
  created_at: string;
  created_by: number;
  approved_at?: string | null;
  approved_by?: number | null;
}
