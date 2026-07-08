import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/sonner";
import type { BatchItem, Product } from "@/pages/inventory/inventoryTypes";

// Batch queue — persisted in localStorage with a 12 h expiry so:
//   - navigate away → back: batch survives (sessionStorage broke when the
//     cashier had Inventory in two tabs and closed the active one)
//   - close laptop → next morning: stale batch from yesterday gets dropped
//     instead of silently re-submitting yesterday's items.
const BATCH_KEY = "inventory_batch_queue_v2";
const BATCH_TTL_MS = 12 * 60 * 60 * 1000;
interface BatchEnvelope { items: BatchItem[]; savedAt: number; }

export function useBatchQueue(products: Product[], onConfirmed: () => void) {
  const { t } = useTranslation();
  const [batchItems, setBatchItems] = useState<BatchItem[]>(() => {
    try {
      const saved = localStorage.getItem(BATCH_KEY);
      if (!saved) return [];
      const env = JSON.parse(saved) as BatchEnvelope;
      if (!env?.savedAt || Date.now() - env.savedAt > BATCH_TTL_MS) {
        localStorage.removeItem(BATCH_KEY);
        return [];
      }
      return Array.isArray(env.items) ? env.items : [];
    } catch { return []; }
  });

  useEffect(() => {
    try {
      if (batchItems.length === 0) {
        localStorage.removeItem(BATCH_KEY);
      } else {
        const env: BatchEnvelope = { items: batchItems, savedAt: Date.now() };
        localStorage.setItem(BATCH_KEY, JSON.stringify(env));
      }
    } catch { /* quota / private mode — ignore */ }
  }, [batchItems]);

  const addItem = (item: Omit<BatchItem, "uid">) => {
    setBatchItems((prev) => [...prev, { ...item, uid: `${Date.now()}-${Math.random()}` }]);
  };

  const removeItem = (uid: string) => {
    setBatchItems((prev) => prev.filter((b) => b.uid !== uid));
  };

  const clearBatch = () => setBatchItems([]);

  /** Confirm and process all items in batch queue via API */
  const confirmAll = async () => {
    if (batchItems.length === 0) {
      toast.error(t("inventory.errorBatchEmpty"));
      return;
    }
    // Group batch items by shop
    const itemsByShop: Record<string, { product_id: number; qty: number; cost_per_unit: number; po?: string; invoice?: string; note?: string }[]> = {};
    for (const item of batchItems) {
      const product = products.find((p) => p.id === parseInt(item.productId));
      if (!product) continue;
      const sid = product.subMerchantId;
      if (!itemsByShop[sid]) itemsByShop[sid] = [];
      itemsByShop[sid].push({
        product_id: product.id,
        qty: parseInt(item.qty),
        cost_per_unit: parseFloat(item.cost),
        po: item.po || undefined,
        invoice: item.invoice || undefined,
        note: item.note || undefined,
      });
    }
    try {
      for (const [sid, items] of Object.entries(itemsByShop)) {
        await api.post(`/shops/${sid}/receive`, { items });
      }
      toast.success(t("inventory.confirmAll", { count: batchItems.length }).replace("{{count}}", String(batchItems.length)));
      setBatchItems([]);
      onConfirmed();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to receive stock");
    }
  };

  return { batchItems, addItem, removeItem, clearBatch, confirmAll };
}
