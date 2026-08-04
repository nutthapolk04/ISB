import { useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import {
    closestCenter,
    PointerSensor,
    TouchSensor,
    KeyboardSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { toast } from "@/components/ui/sonner";
import { api, ApiError } from "@/lib/api";
import type { Product } from "@/pages/store/storeTypes";

export interface UseProductReorderArgs {
    shopId: string | null | undefined;
    role: string | null | undefined;
    allProducts: Product[];
    setAllProducts: Dispatch<SetStateAction<Product[]>>;
    activePanelId: number | null;
    panelIncluded: Record<number, Set<number>>;
    /**
     * Re-fetch a single panel's items (price/short-name/included Set) after a
     * panel-scoped save, so the Set's insertion order reflects the new
     * sort_order immediately instead of only after a full page reload.
     */
    refetchPanelProducts?: (panelId: number) => Promise<void>;
}

/** Drag-to-reorder for the POS product grid, scoped per shop + optional price panel. */
export function useProductReorder({ shopId, role, allProducts, setAllProducts, activePanelId, panelIncluded, refetchPanelProducts }: UseProductReorderArgs) {
    const { t } = useTranslation();
    const [reorderMode, setReorderMode] = useState(false);
    const [reorderDirty, setReorderDirty] = useState(false);
    const [sortVersions, setSortVersions] = useState<Record<string, number>>({});
    const [reorderSaving, setReorderSaving] = useState(false);
    const [reorderItems, setReorderItems] = useState<Product[]>([]);
    const canManageOrder = role === "admin" || role === "manager" || role === "cashier";

    // PointerSensor on its own dispatches via mouse + pen; touch events on
    // Windows POS terminals don't reliably trigger drag with it (browser
    // tends to capture the touch as a scroll). Add an explicit TouchSensor
    // with a long-press delay so a tap-to-select still works but holding
    // the card for ~250 ms initiates drag mode — clear enough mental model
    // for cashiers without accidental drags during normal POS browsing.
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        setReorderItems((prev) => {
            const oldIdx = prev.findIndex((p) => String(p.id) === String(active.id));
            const newIdx = prev.findIndex((p) => String(p.id) === String(over.id));
            if (oldIdx === -1 || newIdx === -1) return prev;
            setReorderDirty(true);
            return arrayMove(prev, oldIdx, newIdx);
        });
    };

    const enterReorderMode = async () => {
        const sid = shopId;
        if (!sid) { setReorderMode(true); return; }
        try {
            const meta = await api.get<{ products_order_version?: number }>(`/shops/${sid}`);
            if (meta.products_order_version != null) {
                setSortVersions((prev) => ({ ...prev, [sid]: meta.products_order_version! }));
            }
        } catch { /* use cached version */ }
        const panelIds = activePanelId !== null ? panelIncluded[activePanelId] : null;
        const shopProds = allProducts.filter((p) => p.subMerchantId === sid);
        if (panelIds) {
            // Use panel-specific order from the Set
            const byId = new Map(shopProds.map((p) => [p.id, p]));
            setReorderItems([...panelIds].map((id) => byId.get(id)).filter((p): p is Product => Boolean(p)));
        } else {
            setReorderItems(shopProds);
        }
        setReorderMode(true);
    };

    const cancelReorderMode = () => {
        setReorderMode(false);
        setReorderDirty(false);
        setReorderItems([]);
    };

    const saveReorder = async () => {
        const sid = shopId;
        if (!sid) return;
        setReorderSaving(true);
        try {
            const panelIds = activePanelId !== null ? panelIncluded[activePanelId] : null;
            const shopProds = allProducts.filter((p) => p.subMerchantId === sid);
            const prods = reorderItems.filter((p) => !p.isBundle);
            const bunds = reorderItems.filter((p) => p.isBundle && p.bundleId != null);

            if (panelIds && activePanelId !== null) {
                // Panel-scoped reorder: send ONE sort_map covering every dragged
                // item (products AND bundles) in their dragged order, to the
                // panel endpoint only. Bundles must NOT go through the global
                // /bundles/reorder endpoint here — that would leak this panel's
                // drag order onto every other tab, the exact bug we're fixing,
                // just for bundles instead of products. Sending a single map
                // also lets products and bundles be interleaved within a panel,
                // which two separate 1..N / 1..M numberings couldn't express.
                const sortMap: Record<string, number> = {};
                reorderItems.forEach((item, idx) => {
                    // Bundles carry a negative UI id in Store; the backend expects
                    // the real bundle id and falls back to bundle_id matching when
                    // product_id misses. NOTE: if a shop ever has a product and a
                    // bundle sharing the same numeric id both included in one panel,
                    // this key collides and the backend matches the product first —
                    // accepted limitation, not solved here.
                    const key = item.isBundle && item.bundleId != null ? String(item.bundleId) : String(item.id);
                    sortMap[key] = idx + 1;
                });
                await api.post<{ success: true; updated: number }>(
                    `/shops/${sid}/price-panels/${activePanelId}/reorder`,
                    { sort_map: sortMap },
                );
                // Refresh the panel's included-ids Set so its insertion order
                // (which drives display order) reflects the new sort_order.
                if (refetchPanelProducts) {
                    await refetchPanelProducts(activePanelId);
                }
            } else {
                // Global reorder: existing endpoint with version/conflict handling
                const productSortMap: Record<string, number> = {};
                prods.forEach((p, idx) => { productSortMap[String(p.id)] = idx + 1; });
                const version = sortVersions[sid] ?? 1;
                const result = await api.post<{ version: number; updated: number }>(
                    `/shops/${sid}/products/reorder`,
                    { version, sort_map: productSortMap },
                );
                setSortVersions((prev) => ({ ...prev, [sid]: result.version }));

                if (bunds.length > 0) {
                    const bundleSortMap: Record<string, number> = {};
                    bunds.forEach((b, idx) => { bundleSortMap[String(b.bundleId!)] = idx + 1; });
                    await api.post(`/shops/${sid}/bundles/reorder`, { sort_map: bundleSortMap });
                }
            }

            setAllProducts((prev) => {
                const result = [...prev];
                if (panelIds) {
                    const prodSlots = prev
                        .map((p, idx) => ({ p, idx }))
                        .filter(({ p }) => p.subMerchantId === sid && !p.isBundle && panelIds.has(p.id))
                        .map(({ idx }) => idx);
                    prodSlots.forEach((slot, i) => { result[slot] = prods[i]; });
                    if (bunds.length > 0) {
                        const bundSlots = prev
                            .map((p, idx) => ({ p, idx }))
                            .filter(({ p }) => p.subMerchantId === sid && p.isBundle && panelIds.has(p.id))
                            .map(({ idx }) => idx);
                        bundSlots.forEach((slot, i) => { result[slot] = bunds[i]; });
                    }
                } else {
                    const others = prev.filter((p) => p.subMerchantId !== sid);
                    return [...reorderItems, ...others];
                }
                return result;
            });

            setReorderMode(false);
            setReorderDirty(false);
            setReorderItems([]);
            toast.success(t("store.orderSaved"));
        } catch (e: any) {
            if (e?.status === 409 || e?.detail?.current_version) {
                toast.error(t("store.orderConflict"));
                const newVer = e?.detail?.current_version;
                if (newVer && sid) setSortVersions((prev) => ({ ...prev, [sid]: newVer }));
            } else {
                toast.error(e instanceof ApiError ? e.detail : t("store.orderSaveFailed"));
            }
        } finally {
            setReorderSaving(false);
        }
    };

    return {
        reorderMode,
        reorderDirty,
        reorderSaving,
        reorderItems,
        canManageOrder,
        sensors,
        collisionDetection: closestCenter,
        handleDragEnd,
        enterReorderMode,
        cancelReorderMode,
        saveReorder,
        setSortVersions,
    };
}
