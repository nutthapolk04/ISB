import { useState } from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { getCanteenImage, getCanteenFallback } from "./canteenImages";
import type { CanteenProduct, PriceMode } from "@/hooks/useCanteenCart";

interface ProductCardProps {
  product: CanteenProduct;
  justAdded: boolean;
  onAdd: () => void;
  priceMode: PriceMode;
}

export function ProductCard({
  product,
  justAdded,
  onAdd,
  priceMode,
}: ProductCardProps) {
  const [imgError, setImgError] = useState(false);
  const imageUrl = getCanteenImage(product.productCode);
  const fallback = getCanteenFallback(product.category);
  const FallbackIcon = fallback.Icon;
  const showImage = imageUrl && !imgError;
  const displayPrice =
    priceMode === "internal" ? product.internalPrice : product.price;
  const isInternal = priceMode === "internal";

  return (
    <button
      type="button"
      onClick={onAdd}
      data-added={justAdded}
      data-card-color={showImage && product.color ? "true" : undefined}
      className="canteen-product-card text-left"
      style={
        showImage && product.color
          ? ({ "--card-color": product.color } as React.CSSProperties)
          : undefined
      }
    >
      <div
        className={cn(
          "canteen-product-card-image",
          !showImage && !product.color && fallback.gradient,
        )}
        style={!showImage && product.color ? { backgroundColor: product.color } : undefined}
      >
        {showImage ? (
          <img
            src={imageUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-amber-900/70">
            <FallbackIcon className="h-16 w-16" aria-hidden />
          </div>
        )}
        {isInternal && (
          <span className="absolute right-2 top-2 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-2 py-0.5 text-[10px] font-semibold uppercase text-white shadow">
            Staff
          </span>
        )}
        <div className="canteen-product-card-badge">
          <Check className="h-12 w-12" strokeWidth={3} />
        </div>
      </div>
      <div className="flex flex-col gap-0.5 p-3">
        <div className="line-clamp-2 text-sm font-semibold leading-snug">
          {product.name}
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-lg font-bold text-amber-700 tabular-nums">
            ฿{displayPrice.toFixed(0)}
          </span>
        </div>
      </div>
    </button>
  );
}
