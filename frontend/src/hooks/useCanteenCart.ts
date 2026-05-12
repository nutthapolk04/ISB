import { useCallback, useMemo, useState } from "react";
import type { SelectedOptionGroup } from "@/pages/canteen/menuOptionTypes";

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

export interface CanteenCartItem extends CanteenProduct {
  /** Stable per-line identifier (so same product with different options are distinct lines). */
  cartLineId: string;
  quantity: number;
  selectedOptions: SelectedOptionGroup[];
  /** Sum of (option price_delta × option quantity) across all selected options. */
  optionsTotal: number;
  /** Cashier-entered one-time price override for this line (excludes options). */
  priceOverride?: number | null;
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
          ...prev,
          {
            ...product,
            cartLineId: lineId,
            quantity: 1,
            selectedOptions: [],
            optionsTotal: 0,
          },
        ];
      });
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
          ...prev,
          {
            ...product,
            cartLineId: lineId,
            quantity: 1,
            selectedOptions,
            optionsTotal,
          },
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
      prev.flatMap((i) => {
        if (i.cartLineId !== cartLineId) return [i];
        const next = i.quantity - 1;
        return next <= 0 ? [] : [{ ...i, quantity: next }];
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
        return sum + (base + i.optionsTotal) * i.quantity;
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
    addItemWithOptions,
    incrementLine,
    decrementLine,
    removeLine,
    setLinePriceOverride,
    setBillDiscount,
    clearDiscount,
    clearCart,
    setPriceMode,
    priceFor,
    unitPriceFor,
  };
}
