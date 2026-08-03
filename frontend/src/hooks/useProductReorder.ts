import { useState } from "react";
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

interface UseProductReorderArgs {
    shopId: string | null | undefined;
    role: string | null | undefined;
    allProducts: Product[];
    setAllProducts: React.Dispatch<React.SetStateAction<Product[]>>;
    activePanelId: number | null;
    panelIncluded: Record<number, Set<number>>;
}

/** Drag-to-reorder for the POS product grid, scoped per shop + optional price panel. */
export function useProductReorder({ shopId, role, allProducts, setAllProducts, activePanelId, panelIncluded }: UseProductReorderArgs) {
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
                // Panel-scoped product reorder: new endpoint, no version/conflict handling
                const productSortMap: Record<string, number> = {};
                prods.forEach((p, idx) => { productSortMap[String(p.id)] = idx + 1; });
                await api.post<{ success: true; updated: number }>(
                    `/shops/${sid}/price-panels/${activePanelId}/reorder`,
                    { sort_map: productSortMap },
                );
                // Bundle reorder still uses global endpoint (no panel-scoped version yet)
                if (bunds.length > 0) {
                    const bundleSortMap: Record<string, number> = {};
                    bunds.forEach((b, idx) => { bundleSortMap[String(b.bundleId!)] = idx + 1; });
                    await api.post(`/shops/${sid}/bundles/reorder`, { sort_map: bundleSortMap });
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
