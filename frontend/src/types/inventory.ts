/**
 * Inventory-domain TypeScript types.
 * Mirrors backend models in `backend/app/models/stock.py`.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type InventoryTransactionType =
  | "sale"
  | "return"
  | "adjustment"
  | "internal_issue"
  | "initial";

// ---------------------------------------------------------------------------
// Stock Level
// ---------------------------------------------------------------------------

export interface StockLevel {
  id: number;
  product_variant_id: number;
  quantity: number;
  low_stock_threshold: number;
  location?: string | null;
  updated_at: string;
  updated_by?: number | null;
  /** Joined from ProductVariant */
  product_variant?: {
    sku: string;
    variant_name: string;
    barcode?: string | null;
    retail_price: number;
    product?: {
      name: string;
      category?: { name: string } | null;
    };
  };
}

// ---------------------------------------------------------------------------
// Inventory Transaction
// ---------------------------------------------------------------------------

export interface InventoryTransaction {
  id: number;
  transaction_type: InventoryTransactionType;
  product_variant_id: number;
  quantity_change: number;
  reference_type?: string | null;
  reference_id?: number | null;
  reason?: string | null;
  created_at: string;
  created_by: number;
}

// ---------------------------------------------------------------------------
// Stock Movement (audit trail)
// ---------------------------------------------------------------------------

export interface StockMovement {
  id: number;
  product_variant_id: number;
  quantity_before: number;
  quantity_change: number;
  quantity_after: number;
  movement_type: InventoryTransactionType;
  reference_document?: string | null;
  notes?: string | null;
  created_at: string;
  created_by: number;
}

// ---------------------------------------------------------------------------
// Mutation payloads
// ---------------------------------------------------------------------------

export interface StockAdjustPayload {
  product_variant_id: number;
  quantity_change: number;
  reason: string;
}
