// ── Types (match backend TransactionDTO — pos_transaction_service.ts) ──────────

export type TransactionStatus = "pending" | "success" | "failed" | "cancelled";

export interface TransactionApi {
    id: number;
    ref_code: string | null;
    status: TransactionStatus;
    transaction_mode: string | null;
    payment_method: string;
    shop_id: string | null;
    shop_name: string | null;
    cashier_user_id: number | null;
    cashier_name: string | null;
    payer_kind: string | null;
    payer_id: number | null;
    payer_label: string | null;
    payer_code: string | null;
    items_count: number | null;
    amount: number | null;
    receipt_id: number | null;
    receipt_number: string | null;
    error_message: string | null;
    created_at: string;
    resolved_at: string | null;
    seq?: number;
}

export interface TransactionListResponse {
    items: TransactionApi[];
    total: number;
    page: number;
    pages: number;
    page_size: number;
}

export interface TransactionItemApi {
    product_variant_id: number | null;
    quantity: number;
    unit_price: number | null;
    is_bundle: boolean;
    bundle_id: number | null;
    name: string;
}

/** Fetched on demand (GET /pos/transactions/:id) when the detail dialog
 *  opens — the list endpoint never returns items, to keep list pages light. */
export interface TransactionDetailApi extends TransactionApi {
    items?: TransactionItemApi[];
}
