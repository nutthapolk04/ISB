/**
 * Cart state hook using React state (local, not server).
 *
 * This manages the in-progress cart before checkout.
 * On checkout, the `useCheckout()` mutation from `useReceipts` is called.
 */

import { useState, useCallback, useMemo } from "react";
import type { ProductVariant } from "@/types/product";
import type { PaymentMethodType, TransactionMode } from "@/types/receipt";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CartItem {
  variant: ProductVariant;
  quantity: number;
  unit_price: number;
  /** Cashier-entered one-time override (null = none). Replaces unit_price for
   * line-total math; unit_price stays as the catalog price for audit. */
  price_override?: number | null;
  discount: number;
}

export interface CartState {
  items: CartItem[];
  paymentMethod: PaymentMethodType;
  transactionMode: TransactionMode;
  customerId?: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>("cash");
  const [transactionMode, setTransactionMode] = useState<TransactionMode>("sale");
  const [customerId, setCustomerId] = useState<number | undefined>();
  const [notes, setNotes] = useState("");

  // ---- Derived ----

  const subtotal = useMemo(
    () =>
      items.reduce((sum, i) => {
        const effective = i.price_override != null ? i.price_override : i.unit_price;
        return sum + effective * i.quantity - i.discount;
      }, 0),
    [items],
  );

  const itemCount = useMemo(
    () => items.reduce((sum, i) => sum + i.quantity, 0),
    [items],
  );

  // ---- Actions ----

  const addItem = useCallback(
    (variant: ProductVariant, priceMode: "retail" | "cost" = "retail") => {
      setItems((prev) => {
        const existing = prev.find((i) => i.variant.id === variant.id);
        if (existing) {
          return prev.map((i) =>
            i.variant.id === variant.id
              ? { ...i, quantity: i.quantity + 1 }
              : i,
          );
        }
        return [
          ...prev,
          {
            variant,
            quantity: 1,
            unit_price:
              priceMode === "cost" ? variant.cost_price : variant.retail_price,
            discount: 0,
          },
        ];
      });
    },
    [],
  );

  const removeItem = useCallback((variantId: number) => {
    setItems((prev) => prev.filter((i) => i.variant.id !== variantId));
  }, []);

  const updateQuantity = useCallback((variantId: number, qty: number) => {
    if (qty <= 0) {
      setItems((prev) => prev.filter((i) => i.variant.id !== variantId));
      return;
    }
    setItems((prev) =>
      prev.map((i) =>
        i.variant.id === variantId ? { ...i, quantity: qty } : i,
      ),
    );
  }, []);

  const setLinePriceOverride = useCallback(
    (variantId: number, price: number | null) => {
      setItems((prev) =>
        prev.map((i) =>
          i.variant.id === variantId
            ? {
                ...i,
                price_override:
                  price === null || isNaN(price) || price < 0 ? null : price,
              }
            : i,
        ),
      );
    },
    [],
  );

  const clearCart = useCallback(() => {
    setItems([]);
    setNotes("");
    setCustomerId(undefined);
  }, []);

  return {
    // State
    items,
    paymentMethod,
    transactionMode,
    customerId,
    notes,
    subtotal,
    itemCount,

    // Setters
    setPaymentMethod,
    setTransactionMode,
    setCustomerId,
    setNotes,

    // Actions
    addItem,
    removeItem,
    updateQuantity,
    setLinePriceOverride,
    clearCart,
  };
}
