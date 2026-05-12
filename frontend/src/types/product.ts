/**
 * Product-domain TypeScript types.
 * Mirrors backend Pydantic schemas in `backend/app/schemas/product.py`.
 */

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

export interface Category {
  id: number;
  name: string;
  description?: string | null;
  parent_id?: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Product Variant
// ---------------------------------------------------------------------------

export interface ProductVariant {
  id: number;
  product_id: number;
  sku: string;
  variant_name: string;
  color?: string | null;
  size?: string | null;
  barcode?: string | null;
  cost_price: number;
  retail_price: number;
  image_url?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Populated from StockLevel when include_stock is true */
  stock_quantity?: number | null;
}

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

export interface Product {
  id: number;
  name: string;
  description?: string | null;
  category_id: number;
  brand?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  category?: Category | null;
  variants: ProductVariant[];
}

// ---------------------------------------------------------------------------
// Search / paginated response
// ---------------------------------------------------------------------------

export interface ProductSearchResponse {
  total: number;
  items: ProductVariant[];
  page: number;
  page_size: number;
}

// ---------------------------------------------------------------------------
// Mutation payloads
// ---------------------------------------------------------------------------

export interface ProductCreate {
  name: string;
  description?: string;
  category_id: number;
  brand?: string;
  variants?: ProductVariantCreate[];
}

export interface ProductVariantCreate {
  sku: string;
  variant_name: string;
  color?: string;
  size?: string;
  barcode?: string;
  cost_price: number;
  retail_price: number;
  image_url?: string;
}
