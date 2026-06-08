import { ProductCard } from "./ProductCard";
import type { CanteenProduct, PriceMode } from "@/hooks/useCanteenCart";
import { UtensilsCrossed } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface ProductGridProps {
  products: CanteenProduct[];
  /** Product id most recently added without options — drives the flash highlight. */
  lastAddedProductId: number | null;
  onAdd: (product: CanteenProduct) => void;
  loading?: boolean;
  priceMode: PriceMode;
  /** Panel short-name overrides: productId → short name. */
  shortNames?: Record<number, string>;
  /** When true, tiles render with drag handles instead of click-to-add. */
  reorderMode?: boolean;
  /** Color-editor popover open for this product id (null = closed). */
  colorEditId?: number | null;
  colorSaving?: boolean;
  onOpenColorEdit?: (id: number) => void;
  onCloseColorEdit?: () => void;
  onSaveColor?: (product: CanteenProduct, color: string | null) => void;
}

// Sortable wrapper — only used in reorder mode. Must live outside the main
// component so its hook order is stable as the list re-renders.
function SortableCard({
  id,
  children,
}: {
  id: number;
  children: (handleProps: React.HTMLAttributes<HTMLElement>, isDragging: boolean) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(id) });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        position: "relative",
        // touch-action: none disables the browser's default touch
        // gestures (scroll / pinch / zoom) over the card while it's in
        // reorder mode, otherwise Windows touch terminals capture the
        // touch as a scroll and the TouchSensor never fires.
        touchAction: "none",
      }}
    >
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  );
}

export function ProductGrid({
  products,
  lastAddedProductId,
  onAdd,
  loading,
  priceMode,
  shortNames,
  reorderMode = false,
  colorEditId,
  colorSaving,
  onOpenColorEdit,
  onCloseColorEdit,
  onSaveColor,
}: ProductGridProps) {
  if (loading) {
    return (
      <div className="canteen-grid">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-amber-100 bg-card/60 aspect-[1/1.3] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-amber-200 bg-card/50 p-12 text-center">
        <UtensilsCrossed className="h-10 w-10 text-amber-400" />
        <p className="mt-3 text-sm text-muted-foreground">
          No items match the current filter.
        </p>
      </div>
    );
  }

  return (
    <div className="canteen-grid">
      {products.map((p) => {
        if (reorderMode) {
          return (
            <SortableCard key={p.id} id={p.id}>
              {(handleProps) => (
                <ProductCard
                  product={p}
                  justAdded={false}
                  onAdd={() => {}}
                  priceMode={priceMode}
                  overrideName={shortNames?.[p.id]}
                  reorderMode
                  dragHandleProps={handleProps}
                />
              )}
            </SortableCard>
          );
        }
        return (
          <ProductCard
            key={p.id}
            product={p}
            justAdded={lastAddedProductId === p.id}
            onAdd={() => onAdd(p)}
            priceMode={priceMode}
            overrideName={shortNames?.[p.id]}
            colorEditOpen={colorEditId === p.id}
            colorSaving={colorSaving ?? false}
            onOpenColorEdit={onOpenColorEdit ? () => onOpenColorEdit(p.id) : undefined}
            onCloseColorEdit={onCloseColorEdit}
            onSaveColor={onSaveColor ? (color) => onSaveColor(p, color) : undefined}
          />
        );
      })}
    </div>
  );
}
