import { ProductCard } from "./ProductCard";
import type { CanteenProduct, PriceMode } from "@/hooks/useCanteenCart";
import { UtensilsCrossed } from "lucide-react";

interface ProductGridProps {
  products: CanteenProduct[];
  /** Product id most recently added without options — drives the flash highlight. */
  lastAddedProductId: number | null;
  onAdd: (product: CanteenProduct) => void;
  loading?: boolean;
  priceMode: PriceMode;
}

export function ProductGrid({
  products,
  lastAddedProductId,
  onAdd,
  loading,
  priceMode,
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
      {products.map((p) => (
        <ProductCard
          key={p.id}
          product={p}
          justAdded={lastAddedProductId === p.id}
          onAdd={() => onAdd(p)}
          priceMode={priceMode}
        />
      ))}
    </div>
  );
}
