import { useCallback, useMemo, useState } from "react";
import type { SelectedOptionGroup } from "@/types/menuOptions";

export interface CanteenProduct {
  id: number;
  productCode: string;
  name: string;
  price: number;
  internalPrice: number;
  category: string;
  stock: number;
  hasOptions: boolean;
  color?: string | null;
}

export type LineDiscountMode = "percent" | "amount";

export interface CanteenCartItem extends CanteenProduct {
  /** Stable per-line identifier (so same product with different options are distinct lines). */
  cartLineId: string;
  quantity: number;
  selectedOptions: SelectedOptionGroup[];
  /** Sum of (option price_delta × option quantity) across all selected options. */
  optionsTotal: number;
  /** Cashier-entered one-time price override for this line (excludes options). */
  priceOverride?: number | null;
  /** Per-line discount value (in % or ฿ depending on lineDiscountMode). */
  lineDiscountValue?: number;
  /** Whether lineDiscountValue is a percentage or absolute amount. Default "percent". */
  lineDiscountMode?: LineDiscountMode;
}

export type BillDiscountMode = "percent" | "amount";
export type PriceMode = "retail" | "internal";

export interface CanteenCartState {
  items: CanteenCartItem[];
  lastAddedLineId: string | null;
  billDiscountMode: BillDiscountMode;
  billDiscountValue: number;
  priceMode: PriceMode;
  subtotal: number;
  billDiscountAmount: number;
  total: number;
  itemCount: number;
  /** Add item with no options — plain products. */
  addItem: (product: CanteenProduct) => void;
  /** Add a special item (price=0) with a cashier-entered price. Always creates a new line. */
  addSpecialItem: (product: CanteenProduct, price: number) => void;
  /** Add item with explicit options (from MenuOptionModal). */
  addItemWithOptions: (
    product: CanteenProduct,
    selectedOptions: SelectedOptionGroup[],
  ) => void;
  incrementLine: (cartLineId: string) => void;
  decrementLine: (cartLineId: string) => void;
  removeLine: (cartLineId: string) => void;
  /** Set or clear (null) a one-time price override for the given line. */
  setLinePriceOverride: (cartLineId: string, price: number | null) => void;
  /** Set per-line discount. pass null value to clear. */
  setLineDiscount: (cartLineId: string, value: number | null, mode: LineDiscountMode) => void;
  /** Computed discount amount (฿) for a single cart line. */
  lineDiscountAmountFor: (item: CanteenCartItem) => number;
  setBillDiscount: (mode: BillDiscountMode, value: number) => void;
  clearDiscount: () => void;
  clearCart: () => void;
  setPriceMode: (mode: PriceMode) => void;
  priceFor: (item: CanteenCartItem | CanteenProduct) => number;
  /** Unit price including options delta. */
  unitPriceFor: (item: CanteenCartItem) => number;
}

function fingerprintOptions(groups: SelectedOptionGroup[]): string {
  // Canonical serialisation so equivalent selections collapse onto one line.
  return groups
    .map((g) =>
      g.options
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((o) => `${g.groupId}:${o.id}:${o.quantity}`)
        .join(","),
    )
    .sort()
    .join("|");
}

function generateLineId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `line_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function useCanteenCart(): CanteenCartState {
  const [items, setItems] = useState<CanteenCartItem[]>([]);
  const [lastAddedLineId, setLastAddedLineId] = useState<string | null>(null);
  const [billDiscountMode, setBillDiscountMode] =
    useState<BillDiscountMode>("percent");
  const [billDiscountValue, setBillDiscountValue] = useState<number>(0);
  const [priceMode, setPriceMode] = useState<PriceMode>("retail");

  const flashLine = useCallback((lineId: string) => {
    setLastAddedLineId(lineId);
    window.setTimeout(() => {
      setLastAddedLineId((cur) => (cur === lineId ? null : cur));
    }, 450);
  }, []);

  const addItem = useCallback(
    (product: CanteenProduct) => {
      setItems((prev) => {
        // No-options products collapse by product id — fingerprint is "".
        const existing = prev.find(
          (i) => i.id === product.id && i.selectedOptions.length === 0,
        );
        if (existing) {
          flashLine(existing.cartLineId);
          return prev.map((i) =>
            i.cartLineId === existing.cartLineId
              ? { ...i, quantity: i.quantity + 1 }
              : i,
          );
        }
        const lineId = generateLineId();
        flashLine(lineId);
        return [
          {
            ...product,
            cartLineId: lineId,
            quantity: 1,
            selectedOptions: [],
            optionsTotal: 0,
          },
          ...prev,
        ];
      });
    },
    [flashLine],
  );

  const addSpecialItem = useCallback(
    (product: CanteenProduct, price: number) => {
      // Special items always get their own line (no dedup) since each may have a different price.
      const lineId = generateLineId();
      flashLine(lineId);
      setItems((prev) => [
        {
          ...product,
          cartLineId: lineId,
          quantity: 1,
          selectedOptions: [],
          optionsTotal: 0,
          priceOverride: price,
        },
        ...prev,
      ]);
    },
    [flashLine],
  );

  const addItemWithOptions = useCallback(
    (product: CanteenProduct, selectedOptions: SelectedOptionGroup[]) => {
      const optionsTotal = selectedOptions.reduce(
        (sum, g) =>
          sum +
          g.options.reduce(
            (gs, o) => gs + o.priceDelta * o.quantity,
            0,
          ),
        0,
      );
      const fingerprint = fingerprintOptions(selectedOptions);
      setItems((prev) => {
        const existing = prev.find(
          (i) =>
            i.id === product.id &&
            fingerprintOptions(i.selectedOptions) === fingerprint,
        );
        if (existing) {
          flashLine(existing.cartLineId);
          return prev.map((i) =>
            i.cartLineId === existing.cartLineId
              ? { ...i, quantity: i.quantity + 1 }
              : i,
          );
        }
        const lineId = generateLineId();
        flashLine(lineId);
        return [
          {
            ...product,
            cartLineId: lineId,
            quantity: 1,
            selectedOptions,
            optionsTotal,
          },
          ...prev,
        ];
      });
    },
    [flashLine],
  );

  const incrementLine = useCallback((cartLineId: string) => {
    setItems((prev) =>
      prev.map((i) =>
        i.cartLineId === cartLineId ? { ...i, quantity: i.quantity + 1 } : i,
      ),
    );
  }, []);

  const decrementLine = useCallback((cartLineId: string) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.cartLineId !== cartLineId) return i;
        const next = i.quantity - 1;
        return { ...i, quantity: next === 0 ? -1 : next };
      }),
    );
  }, []);

  const removeLine = useCallback((cartLineId: string) => {
    setItems((prev) => prev.filter((i) => i.cartLineId !== cartLineId));
  }, []);

  const setLinePriceOverride = useCallback(
    (cartLineId: string, price: number | null) => {
      setItems((prev) =>
        prev.map((i) =>
          i.cartLineId === cartLineId
            ? { ...i, priceOverride: price === null || isNaN(price) || price < 0 ? null : price }
            : i,
        ),
      );
    },
    [],
  );

  const setLineDiscount = useCallback(
    (cartLineId: string, value: number | null, mode: LineDiscountMode) => {
      setItems((prev) =>
        prev.map((i) =>
          i.cartLineId === cartLineId
            ? {
                ...i,
                lineDiscountValue: value === null || isNaN(value as number) || (value as number) < 0 ? undefined : (value as number),
                lineDiscountMode: mode,
              }
            : i,
        ),
      );
    },
    [],
  );

  const lineDiscountAmountFor = useCallback(
    (item: CanteenCartItem): number => {
      const val = item.lineDiscountValue;
      if (!val || val <= 0) return 0;
      const base = item.priceOverride != null
        ? item.priceOverride
        : priceMode === "internal" ? item.internalPrice : item.price;
      const gross = (base + item.optionsTotal) * item.quantity;
      if (item.lineDiscountMode === "amount") {
        return Math.min(gross, val);
      }
      // percent (default)
      return Math.min(gross, Math.round((gross * val / 100) * 100) / 100);
    },
    [priceMode],
  );

  const setBillDiscount = useCallback(
    (mode: BillDiscountMode, value: number) => {
      setBillDiscountMode(mode);
      setBillDiscountValue(Math.max(0, value));
    },
    [],
  );

  const clearDiscount = useCallback(() => {
    setBillDiscountValue(0);
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setBillDiscountValue(0);
    setLastAddedLineId(null);
  }, []);

  const priceFor = useCallback(
    (item: CanteenCartItem | CanteenProduct) => {
      // Override only applies to cart items (CanteenCartItem has priceOverride),
      // not to the product card on the grid.
      const cartItem = item as CanteenCartItem;
      if (cartItem.priceOverride != null) return cartItem.priceOverride;
      return priceMode === "internal" ? item.internalPrice : item.price;
    },
    [priceMode],
  );

  const unitPriceFor = useCallback(
    (item: CanteenCartItem) => {
      const base = item.priceOverride != null
        ? item.priceOverride
        : priceMode === "internal" ? item.internalPrice : item.price;
      return base + item.optionsTotal;
    },
    [priceMode],
  );

  const subtotal = useMemo(
    () =>
      items.reduce((sum, i) => {
        const base = i.priceOverride != null
          ? i.priceOverride
          : priceMode === "internal" ? i.internalPrice : i.price;
        const gross = (base + i.optionsTotal) * i.quantity;
        const disc = (() => {
          const val = i.lineDiscountValue;
          if (!val || val <= 0) return 0;
          if (i.lineDiscountMode === "amount") return Math.min(gross, val);
          return Math.min(gross, Math.round((gross * val / 100) * 100) / 100);
        })();
        return sum + gross - disc;
      }, 0),
    [items, priceMode],
  );

  const billDiscountAmount = useMemo(() => {
    if (billDiscountValue <= 0 || subtotal <= 0) return 0;
    const raw =
      billDiscountMode === "percent"
        ? (subtotal * billDiscountValue) / 100
        : billDiscountValue;
    return Math.max(0, Math.min(raw, subtotal));
  }, [billDiscountMode, billDiscountValue, subtotal]);

  const total = useMemo(
    () => Math.max(0, subtotal - billDiscountAmount),
    [subtotal, billDiscountAmount],
  );

  const itemCount = useMemo(
    () => items.reduce((sum, i) => sum + i.quantity, 0),
    [items],
  );

  return {
    items,
    lastAddedLineId,
    billDiscountMode,
    billDiscountValue,
    priceMode,
    subtotal,
    billDiscountAmount,
    total,
    itemCount,
    addItem,
    addSpecialItem,
    addItemWithOptions,
    incrementLine,
    decrementLine,
    removeLine,
    setLinePriceOverride,
    setLineDiscount,
    lineDiscountAmountFor,
    setBillDiscount,
    clearDiscount,
    clearCart,
    setPriceMode,
    priceFor,
    unitPriceFor,
  };
}
