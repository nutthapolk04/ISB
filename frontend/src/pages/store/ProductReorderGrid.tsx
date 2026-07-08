import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { GripVertical, Package } from "lucide-react";
import {
    DndContext,
    type CollisionDetection,
    type DragEndEvent,
    type SensorDescriptor,
    type SensorOptions,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useRecentColors } from "@/hooks/useRecentColors";
import { SortableCard } from "./SortableCard";
import { ProductColorEditor } from "./ProductColorEditor";
import type { Product } from "./storeTypes";

interface ProductReorderGridProps {
    allProducts: Product[];
    setAllProducts: React.Dispatch<React.SetStateAction<Product[]>>;
    reorderMode: boolean;
    reorderItems: Product[];
    sensors: SensorDescriptor<SensorOptions>[];
    collisionDetection: CollisionDetection;
    onDragEnd: (event: DragEndEvent) => void;
    activePanelId: number | null;
    panelIncluded: Record<number, Set<number>>;
    panelShortNames: Record<number, Record<number, string>>;
    priceMode: "retail" | "internal";
    getPrice: (p: Product) => number;
    addToCart: (p: Product) => void;
    shopId: string | null | undefined;
    canEditColor: boolean;
}

/** POS browse grid — product cards, drag-to-reorder, and per-card color editing. */
export function ProductReorderGrid({
    allProducts,
    setAllProducts,
    reorderMode,
    reorderItems,
    sensors,
    collisionDetection,
    onDragEnd,
    activePanelId,
    panelIncluded,
    panelShortNames,
    priceMode,
    getPrice,
    addToCart,
    shopId,
    canEditColor,
}: ProductReorderGridProps) {
    const { t } = useTranslation();
    const { recentColors, addRecentColor } = useRecentColors(shopId ?? "store");

    const [colorEditId, setColorEditId] = useState<number | null>(null);
    const [colorEditValue, setColorEditValue] = useState("#e2e8f0");
    const [colorSaving, setColorSaving] = useState(false);

    const saveProductColor = async (product: Product, color: string | null) => {
        setColorSaving(true);
        try {
            if (product.isBundle && product.bundleId != null) {
                await api.patch(`/shops/${product.subMerchantId}/bundles/${product.bundleId}`, { color });
            } else {
                await api.patch(`/shops/${product.subMerchantId}/products/${product.id}`, { color });
            }
            setAllProducts((prev) =>
                prev.map((p) => (p.id === product.id ? { ...p, color } : p)),
            );
            toast.success(t("store.colorSaved"));
            setColorEditId(null);
        } catch (e) {
            toast.error(e instanceof ApiError ? e.detail : t("store.colorSaveFailed"));
        } finally {
            setColorSaving(false);
        }
    };

    if (allProducts.length === 0) return null;

    const gridProducts = reorderMode
        ? reorderItems
        : activePanelId != null && panelIncluded[activePanelId]
            ? allProducts.filter((p) => panelIncluded[activePanelId].has(p.id))
            : allProducts;

    const cardContent = (p: Product, handleProps: React.HTMLAttributes<HTMLElement>) => {
        const displayPrice = priceMode === "internal"
            ? (p.internalPrice ?? p.price)
            : getPrice(p);
        const zeroStock = p.stock <= 0;
        const lowStock = p.stock > 0 && p.stock <= 3;
        return (
            <button
                type="button"
                onClick={reorderMode ? undefined : () => addToCart(p)}
                data-card-color={p.color ? "true" : undefined}
                className={cn(
                    "pos-product-tile group relative flex flex-col justify-between rounded-2xl border border-amber-200/60 p-3 text-left transition w-full h-[7.5rem] overflow-hidden",
                    !p.color && !reorderMode && "bg-card hover:-translate-y-0.5 hover:shadow-lg hover:shadow-amber-200/50 hover:border-amber-300",
                    reorderMode && "cursor-default select-none",
                )}
                style={
                    p.color
                        ? ({
                            "--card-color": p.color,
                            backgroundColor: p.color,
                        } as React.CSSProperties)
                        : undefined
                }
                {...(reorderMode ? handleProps : {})}
            >
                {/* Drag handle indicator */}
                {reorderMode && (
                    <div className="absolute top-1 left-1 z-10 rounded bg-background/80 p-0.5 shadow">
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                )}
                {/* Stock badge — top-right for products */}
                {!p.isBundle && (
                    <span className={cn(
                        "absolute right-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums shadow",
                        zeroStock ? "bg-amber-500 text-white" :
                            lowStock ? "bg-orange-400 text-white" :
                                "bg-background/90 text-foreground",
                    )}>
                        {`${t("store.stockLabel")} ${p.stock}`}
                    </span>
                )}
                {/* SET badge — top-right for bundles */}
                {p.isBundle && (
                    <span className="absolute right-1 top-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 border border-violet-300 shadow">
                        SET
                    </span>
                )}
                <div className={cn(
                    // Top margin pushes the name below the absolute Remaining
                    // badge so long two-line names don't overlap with it.
                    "line-clamp-2 text-sm font-bold leading-tight mt-5",
                    p.color ? "text-zinc-900" : "text-foreground",
                )}>
                    {activePanelId != null && panelShortNames[activePanelId]?.[p.id]
                        ? panelShortNames[activePanelId][p.id]
                        : p.name}
                </div>
                <div className="mt-auto pt-1 flex items-end justify-between">
                    <span className={cn(
                        "text-base font-extrabold tabular-nums",
                        p.color ? "text-zinc-900" : "text-primary",
                    )}>฿{displayPrice.toLocaleString()}</span>
                    <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                        {!reorderMode && canEditColor && (
                            <ProductColorEditor
                                color={p.color}
                                open={colorEditId === p.id}
                                onOpenChange={(open) => {
                                    if (open) { setColorEditId(p.id); setColorEditValue(p.color ?? recentColors[0] ?? "#4ade80"); }
                                    else { setColorEditId(null); }
                                }}
                                value={colorEditValue}
                                onValueChange={setColorEditValue}
                                recentColors={recentColors}
                                saving={colorSaving}
                                onClear={() => saveProductColor(p, null)}
                                onSave={() => { addRecentColor(colorEditValue); saveProductColor(p, colorEditValue); }}
                            />
                        )}
                        {!p.isBundle && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 shrink min-w-0 overflow-hidden whitespace-nowrap text-ellipsis block max-w-[5rem]">{p.category}</Badge>
                        )}
                    </div>
                </div>
            </button>
        );
    };

    return (
        <div className="flex-1 flex flex-col min-h-0 rounded-xl border border-border/60 bg-card/40 p-3 gap-3">
            {reorderMode && (
                <p className="text-xs text-muted-foreground shrink-0">
                    <GripVertical className="inline h-3 w-3 mr-1" />
                    {t("store.reorderHint")}
                </p>
            )}
            <div className="flex-1 overflow-y-auto">
                <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
                    <SortableContext items={gridProducts.map((p) => String(p.id))} strategy={rectSortingStrategy}>
                        <div className="canteen-grid">
                            {gridProducts.map((p) => (
                                <SortableCard key={p.id} id={p.id} reorderMode={reorderMode}>
                                    {(handleProps, _isDragging) => cardContent(p, handleProps)}
                                </SortableCard>
                            ))}
                            {gridProducts.length === 0 && (
                                <div className="col-span-full py-6 text-center text-sm text-muted-foreground">
                                    {t("store.noItemsInCategory", "ไม่มีสินค้าในหมวดหมู่นี้")}
                                </div>
                            )}
                        </div>
                    </SortableContext>
                </DndContext>
            </div>
        </div>
    );
}
