/**
 * React Query hooks for product-related API calls.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import type { Product, ProductVariant, ProductSearchResponse } from "@/types/product";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const productKeys = {
  all: ["products"] as const,
  lists: () => [...productKeys.all, "list"] as const,
  list: (page: number, pageSize: number) =>
    [...productKeys.lists(), { page, pageSize }] as const,
  search: (query: string) => [...productKeys.all, "search", query] as const,
  detail: (id: number) => [...productKeys.all, "detail", id] as const,
  barcode: (barcode: string) => [...productKeys.all, "barcode", barcode] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Paginated product list. */
export function useProducts(page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  return useQuery({
    queryKey: productKeys.list(page, pageSize),
    queryFn: () =>
      api.get<ProductSearchResponse>(
        `/products?skip=${(page - 1) * pageSize}&limit=${pageSize}`,
      ),
  });
}

/** Full-text search across name, SKU, and barcode. */
export function useProductSearch(query: string) {
  return useQuery({
    queryKey: productKeys.search(query),
    queryFn: () =>
      api.get<ProductVariant[]>(`/products/search?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 1,
    placeholderData: (prev) => prev,
  });
}

/** Single product by ID (with variants). */
export function useProduct(id: number) {
  return useQuery({
    queryKey: productKeys.detail(id),
    queryFn: () => api.get<Product>(`/products/${id}`),
    enabled: id > 0,
  });
}

/** Lookup a single variant by barcode scan. */
export function useProductByBarcode(barcode: string) {
  return useQuery({
    queryKey: productKeys.barcode(barcode),
    queryFn: () => api.get<ProductVariant>(`/products/barcode/${barcode}`),
    enabled: barcode.length >= 4,
  });
}
