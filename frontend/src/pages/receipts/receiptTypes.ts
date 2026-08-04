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
    external_id?: string | null;
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

export interface ReceiptListStats {
    today_active_sales: number;
    month_active_sales: number;
    month_receipt_count: number;
    filtered_active_sales: number;
}

export interface ReceiptListResponse {
    items: ReceiptApi[];
    total: number;
    page: number;
    pages: number;
    page_size: number;
    stats?: ReceiptListStats;
}

/**
 * Unwrap list endpoint — supports legacy bare-array callers during transition.
 *
 * Always returns a real array. `items` used to be handed back unchecked, so any
 * response-shape drift (an envelope wrapper, a cached/proxied body, an error
 * payload served with 200, a backend deployed out of step with this bundle)
 * put a non-array into caller state — and the first `.slice()`/`.map()` on it
 * threw, which the global ErrorBoundary turned into a full-page crash rather
 * than one broken card (e.g. AdminDashboard's Recent Activity list, seen as
 * "TypeError: <x>.slice is not a function" right after signing in).
 */
export function receiptListItems(data: ReceiptApi[] | ReceiptListResponse): ReceiptApi[] {
    if (Array.isArray(data)) return data;
    const items = (data as ReceiptListResponse | null | undefined)?.items;
    return Array.isArray(items) ? items : [];
}
