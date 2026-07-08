import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface PanelItemApi {
  product_id: number;
  included: boolean;
  short_name?: string | null;
  panel_price?: number | null;
}

/** Price panels (replaces category tabs) for a canteen/store shop's POS grid. */
export function usePricePanels(shopId: string) {
  const [panels, setPanels] = useState<{ id: number; name: string; color: string | null }[]>([]);
  const [activePanelId, setActivePanelId] = useState<number | null>(null); // null = All
  // Cache of included product IDs per panel: panelId → Set<productId>
  const [panelProductIds, setPanelProductIds] = useState<Record<number, Set<number>>>({});
  // Cache of short-name overrides per panel: panelId → productId → short_name
  const [panelShortNames, setPanelShortNames] = useState<Record<number, Record<number, string>>>({});
  // Cache of panel price overrides per panel: panelId → productId → panel_price (retail only).
  const [panelPrices, setPanelPrices] = useState<Record<number, Record<number, number>>>({});
  const [panelTabsLoading, setPanelTabsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPanelTabsLoading(true);
    api.get<{ id: number; name: string; color: string | null }[]>(
      `/shops/${shopId}/price-panels`,
    ).then(async (data) => {
      if (cancelled) return;
      setPanels(data);
      // Pre-fetch all panel product IDs so counts are visible immediately
      await Promise.all(data.map(async (panel) => {
        try {
          const items = await api.get<PanelItemApi[]>(
            `/shops/${shopId}/price-panels/${panel.id}/items`,
          );
          if (!cancelled) {
            const ids = new Set(items.filter((i) => i.included).map((i) => i.product_id));
            setPanelProductIds((prev) => ({ ...prev, [panel.id]: ids }));
            const snMap: Record<number, string> = {};
            items.forEach((i) => { if (i.short_name) snMap[i.product_id] = i.short_name; });
            setPanelShortNames((prev) => ({ ...prev, [panel.id]: snMap }));
            const priceMap: Record<number, number> = {};
            items.forEach((i) => {
              if (i.panel_price != null) priceMap[i.product_id] = Number(i.panel_price);
            });
            setPanelPrices((prev) => ({ ...prev, [panel.id]: priceMap }));
          }
        } catch { /* tolerate */ }
      }));
    }).catch(() => {
      // panels optional — fall back to showing all
    }).finally(() => {
      if (!cancelled) setPanelTabsLoading(false);
    });
    return () => { cancelled = true; };
  }, [shopId]);

  const fetchPanelProducts = async (panelId: number) => {
    if (panelProductIds[panelId]) return; // already cached
    try {
      const items = await api.get<PanelItemApi[]>(
        `/shops/${shopId}/price-panels/${panelId}/items`,
      );
      const ids = new Set(items.filter((i) => i.included).map((i) => i.product_id));
      setPanelProductIds((prev) => ({ ...prev, [panelId]: ids }));
      const snMap: Record<number, string> = {};
      items.forEach((i) => { if (i.short_name) snMap[i.product_id] = i.short_name; });
      setPanelShortNames((prev) => ({ ...prev, [panelId]: snMap }));
      const priceMap: Record<number, number> = {};
      items.forEach((i) => {
        if (i.panel_price != null) priceMap[i.product_id] = Number(i.panel_price);
      });
      setPanelPrices((prev) => ({ ...prev, [panelId]: priceMap }));
    } catch {
      // tolerate — panel just shows all if fetch fails
    }
  };

  const handlePanelChange = async (panelId: number | null) => {
    setActivePanelId(panelId);
    if (panelId !== null) await fetchPanelProducts(panelId);
  };

  return {
    panels,
    activePanelId,
    panelProductIds,
    panelShortNames,
    panelPrices,
    panelTabsLoading,
    handlePanelChange,
  };
}
