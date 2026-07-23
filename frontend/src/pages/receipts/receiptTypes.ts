// ── Types (match backend ReceiptResponse) ────────────────────────────────────

export interface ReceiptOptionsSnapshotApi {
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

export interface ReceiptItemApi {
  id: number;
  receipt_id: number;
  product_variant_id: number;
  quantity: number;
  unit_price: number;
  discount: number;
  line_total: number;
  options?: ReceiptOptionsSnapshotApi | null;
  created_at: string;
  product_variant?: {
    sku: string | null;
    variant_name: string | null;
    barcode: string | null;
  } | null;
}

export interface PayerDetail {
  name: string;
  code: string | null;
  grade: string | null;       // grade for students, dept name for staff
  photo_url: string | null;
  role: string;
  wallet_balance: number | null;
}

export interface ReceiptApi {
  id: number;
  receipt_number: string;
  transaction_date: string;
  transaction_mode: string;
  customer_id: number | null;
  payer_user_id?: number | null;
  payer_department_id?: number | null;
  payer_kind?: string | null;
  payer_label?: string | null;
  payer_detail?: PayerDetail | null;
  created_by_name?: string | null;
  shop_id?: string | null;
  shop_name?: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  edc_card_fee?: number;
  total: number;
  payment_method: string;
  status: string;
  notes: string | null;
  cash_received?: number | null;
  created_at: string;
  created_by: number;
  voided_at: string | null;
  voided_by: number | null;
  voided_reason: string | null;
  items: ReceiptItemApi[];
}

export type ModuleScope = "canteen" | "store";
