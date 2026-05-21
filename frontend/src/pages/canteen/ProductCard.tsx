import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Check, Palette, GripVertical } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import type { CanteenProduct, PriceMode } from "@/hooks/useCanteenCart";

interface ProductCardProps {
  product: CanteenProduct;
  justAdded: boolean;
  onAdd: () => void;
  priceMode: PriceMode;
  /** Reorder mode — tile renders a drag handle instead of being clickable. */
  reorderMode?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLElement>;
  /** Color-editor popover open for this card. */
  colorEditOpen?: boolean;
  colorSaving?: boolean;
  onOpenColorEdit?: () => void;
  onCloseColorEdit?: () => void;
  onSaveColor?: (color: string | null) => void;
}

const COLOR_SWATCHES = [
  "#f87171", "#fb923c", "#fbbf24", "#4ade80",
  "#34d399", "#60a5fa", "#a78bfa", "#f472b6", "#94a3b8",
];

// Compact text-only tile matching the Store POS visual (name + price + category
// + optional color palette). Pictures intentionally omitted so cashiers can fit
// ≥24 items per page.
export function ProductCard({
  product,
  justAdded,
  onAdd,
  priceMode,
  reorderMode = false,
  dragHandleProps,
  colorEditOpen = false,
  colorSaving = false,
  onOpenColorEdit,
  onCloseColorEdit,
  onSaveColor,
}: ProductCardProps) {
  const displayPrice =
    priceMode === "internal" ? product.internalPrice : product.price;
  const isInternal = priceMode === "internal";
  const hasColor = !!product.color;
  const showColorPicker = !!onSaveColor;

  // Local draft color for the palette popover (reset every time it opens).
  const [draftColor, setDraftColor] = useState<string>(product.color ?? "#4ade80");
  useEffect(() => {
    if (colorEditOpen) setDraftColor(product.color ?? "#4ade80");
  }, [colorEditOpen, product.color]);

  return (
    <button
      type="button"
      onClick={reorderMode ? undefined : onAdd}
      data-added={justAdded}
      data-card-color={hasColor ? "true" : undefined}
      className={cn(
        "canteen-product-card relative flex flex-col justify-between p-2.5 text-left",
        "min-h-[6.5rem]",
        reorderMode && "cursor-grab active:cursor-grabbing select-none",
      )}
      style={
        hasColor
          ? ({
              "--card-color": product.color,
              backgroundColor: `${product.color}18`,
            } as React.CSSProperties)
          : undefined
      }
      {...(reorderMode ? dragHandleProps : {})}
    >
      {/* Drag handle indicator (reorder mode only) */}
      {reorderMode && (
        <div className="absolute top-1 left-1 z-10 rounded bg-background/80 p-0.5 shadow">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}

      {/* Staff badge — top-right */}
      {isInternal && (
        <span className="absolute right-1 top-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white shadow">
          Staff
        </span>
      )}

      {/* Name */}
      <div className="line-clamp-2 text-sm font-semibold leading-tight">
        {product.name}
      </div>

      {/* Footer: price + (palette) + category */}
      <div className="mt-auto flex items-end justify-between pt-1">
        <span className="text-base font-bold text-amber-700 tabular-nums">
          ฿{displayPrice.toFixed(0)}
        </span>
        <div className="flex items-center gap-1">
          {showColorPicker && (
            <Popover
              open={colorEditOpen}
              onOpenChange={(open) => {
                if (open) onOpenColorEdit?.();
                else onCloseColorEdit?.();
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="rounded p-0.5 transition hover:bg-muted"
                  title="เปลี่ยนสีปุ่ม"
                >
                  <Palette
                    className="h-3.5 w-3.5"
                    style={{ color: product.color ?? undefined }}
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-56 p-3 space-y-3"
                onClick={(e) => e.stopPropagation()}
                side="top"
                align="end"
              >
                <p className="text-xs font-semibold">สีของปุ่ม</p>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draftColor}
                    onChange={(e) => setDraftColor(e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border p-0.5 shrink-0"
                  />
                  <input
                    type="text"
                    value={draftColor}
                    onChange={(e) => setDraftColor(e.target.value)}
                    className="w-full rounded border border-border px-2 py-1 text-xs font-mono bg-background"
                    placeholder="#4ade80"
                  />
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {COLOR_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setDraftColor(c)}
                      className={cn(
                        "h-6 w-6 rounded-full border-2 transition",
                        draftColor === c
                          ? "border-foreground scale-110"
                          : "border-transparent hover:scale-105",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onSaveColor?.(null)}
                    disabled={colorSaving}
                    className="flex-1 rounded-md border border-border bg-background py-1.5 text-[11px] text-muted-foreground hover:bg-muted transition"
                  >
                    ล้างสี
                  </button>
                  <button
                    type="button"
                    onClick={() => onSaveColor?.(draftColor)}
                    disabled={colorSaving}
                    className="flex-1 rounded-md bg-primary py-1.5 text-[11px] text-primary-foreground font-semibold hover:bg-primary/90 transition"
                  >
                    {colorSaving ? "…" : "บันทึก"}
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {product.category && (
            <Badge variant="outline" className="text-[10px] px-1 py-0">
              {product.category}
            </Badge>
          )}
        </div>
      </div>

      <div className="canteen-product-card-badge">
        <Check className="h-10 w-10" strokeWidth={3} />
      </div>
    </button>
  );
}
