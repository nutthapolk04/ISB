import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface BundleItem {
  id: number;
  product_id: number;
  product_name: string;
  product_code: string;
  quantity: number;
  unit_price: number;
  sort_order: number;
}

export interface Bundle {
  id: number;
  shop_id: string;
  bundle_code: string;
  barcode: string | null;
  name: string;
  description: string | null;
  external_price: number;
  internal_price: number;
  photo_url: string | null;
  color: string | null;
  sort_order: number;
  is_active: boolean;
  items: BundleItem[];
  total_items_value: number;
  savings: number;
}

export interface BundleItemCreate {
  product_id: number;
  quantity: number;
}

export interface BundleCreate {
  bundle_code: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  external_price: number;
  internal_price?: number | null;
  color?: string | null;
  items: BundleItemCreate[];
}

export interface BundleUpdate {
  bundle_code?: string;
  barcode?: string | null;
  name?: string;
  description?: string | null;
  external_price?: number;
  internal_price?: number;
  photo_url?: string | null;
  color?: string | null;
  is_active?: boolean;
  items?: BundleItemCreate[];
}

export interface BundleStockStatus {
  bundle_id: number;
  available: boolean;
  max_quantity: number;
  items: {
    product_id: number;
    product_name: string;
    required: number;
    available: number;
    sufficient: boolean;
    max_bundles?: number;
  }[];
}

export function useBundles(shopId: string | null) {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBundles = useCallback(async (includeInactive = false) => {
    if (!shopId) return;

    setLoading(true);
    setError(null);
    try {
      const params = includeInactive ? "?include_inactive=true" : "";
      const data = await api.get<Bundle[]>(`/shops/${shopId}/bundles${params}`);
      setBundles(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch bundles");
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    if (shopId) {
      fetchBundles(true); // Include inactive for management
    }
  }, [shopId, fetchBundles]);

  const getBundle = useCallback(async (bundleId: number): Promise<Bundle | null> => {
    if (!shopId) return null;

    try {
      return await api.get<Bundle>(`/shops/${shopId}/bundles/${bundleId}`);
    } catch (e) {
      throw e;
    }
  }, [shopId]);

  const createBundle = useCallback(async (data: BundleCreate): Promise<Bundle> => {
    if (!shopId) throw new Error("No shop selected");

    const bundle = await api.post<Bundle>(`/shops/${shopId}/bundles`, data);
    await fetchBundles(true);
    return bundle;
  }, [shopId, fetchBundles]);

  const updateBundle = useCallback(async (bundleId: number, data: BundleUpdate): Promise<Bundle> => {
    if (!shopId) throw new Error("No shop selected");

    const bundle = await api.patch<Bundle>(`/shops/${shopId}/bundles/${bundleId}`, data);
    await fetchBundles(true);
    return bundle;
  }, [shopId, fetchBundles]);

  const deleteBundle = useCallback(async (bundleId: number): Promise<void> => {
    if (!shopId) throw new Error("No shop selected");

    await api.delete(`/shops/${shopId}/bundles/${bundleId}`);
    await fetchBundles(true);
  }, [shopId, fetchBundles]);

  const checkStock = useCallback(async (bundleId: number): Promise<BundleStockStatus> => {
    if (!shopId) throw new Error("No shop selected");

    return await api.get<BundleStockStatus>(`/shops/${shopId}/bundles/${bundleId}/stock`);
  }, [shopId]);

  const reorderBundles = useCallback(async (sortMap: Record<number, number>): Promise<void> => {
    if (!shopId) throw new Error("No shop selected");

    await api.post(`/shops/${shopId}/bundles/reorder`, sortMap);
    await fetchBundles(true);
  }, [shopId, fetchBundles]);

  return {
    bundles,
    loading,
    error,
    refetch: fetchBundles,
    getBundle,
    createBundle,
    updateBundle,
    deleteBundle,
    checkStock,
    reorderBundles,
  };
}
