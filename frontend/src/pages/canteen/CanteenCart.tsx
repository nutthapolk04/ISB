import { Minus, Plus, Trash2, Percent, CreditCard, UtensilsCrossed, Pencil, UserCircle2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/IconButton";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { getCanteenImage, getCanteenFallback } from "./canteenImages";
import type {
  CanteenCartItem,
  BillDiscountMode,
  PriceMode,
} from "@/hooks/useCanteenCart";
import type { StudentLookupResult } from "./RfidPaymentModal";

interface CanteenCartProps {
  items: CanteenCartItem[];
  subtotal: number;
  billDiscountMode: BillDiscountMode;
  billDiscountValue: number;
  billDiscountAmount: number;
  total: number;
  priceMode: PriceMode;
  priceFor: (item: CanteenCartItem) => number;
  unitPriceFor: (item: CanteenCartItem) => number;
  onIncrement: (cartLineId: string) => void;
  onDecrement: (cartLineId: string) => void;
  onRemove: (cartLineId: string) => void;
  /** Cashier price override — pass `null` to clear. */
  onSetLinePrice: (cartLineId: string, price: number | null) => void;
  onOpenDiscount: () => void;
  onClearDiscount: () => void;
  onCharge: () => void;
  /** When rendered inside a mobile Sheet, suppress the aside-style panel chrome. */
  asSheet?: boolean;
  /** Pre-selected member for payment */
  selectedMember?: StudentLookupResult | null;
  /** Clear the selected member */
  onClearMember?: () => void;
}

export function CanteenCart({
  items,
  subtotal,
  billDiscountMode,
  billDiscountValue,
  billDiscountAmount,
  total,
  priceMode,
  priceFor: _priceFor,
  unitPriceFor,
  onIncrement,
  onDecrement,
  onRemove,
  onSetLinePrice,
  onOpenDiscount,
  onClearDiscount,
  onCharge,
  asSheet = false,
  selectedMember,
  onClearMember,
}: CanteenCartProps) {
  const { t } = useTranslation();
  const isEmpty = items.length === 0;

  // Debug: log selectedMember
  console.log("CanteenCart selectedMember:", selectedMember);
  const discountLabel =
    billDiscountValue > 0
      ? billDiscountMode === "percent"
        ? `${billDiscountValue}%`
        : `฿${billDiscountValue.toFixed(0)}`
      : null;

  return (
    <aside className={asSheet ? "canteen-cart-sheet" : "canteen-cart-panel"}>
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          Order
          {priceMode === "internal" && (
            <span className="rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-2 py-0.5 text-[10px] font-semibold uppercase text-white shadow">
              Staff
            </span>
          )}
        </h2>
        <p className="text-xs text-muted-foreground">
          {items.reduce((s, i) => s + i.quantity, 0)} item
          {items.reduce((s, i) => s + i.quantity, 0) === 1 ? "" : "s"}
        </p>
      </div>

      {/* Selected Member */}
      {selectedMember && (
        <div className="mx-3 mb-2 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-3">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-amber-100 ring-2 ring-amber-300">
              {selectedMember.photo_url ? (
                <img
                  src={selectedMember.photo_url}
                  alt={selectedMember.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-amber-400">
                  <UserCircle2 className="h-8 w-8" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm truncate">{selectedMember.name}</div>
              <div className="text-xs text-muted-foreground">
                {selectedMember.student_code ?? selectedMember.customer_code}
                {selectedMember.grade && ` · Grade ${selectedMember.grade}`}
              </div>
              <div className="text-sm font-bold tabular-nums text-emerald-600">
                ฿{(selectedMember.wallet_balance ?? 0).toFixed(2)}
              </div>
            </div>
            {onClearMember && (
              <button
                type="button"
                onClick={onClearMember}
                className="shrink-0 rounded-full p-1.5 hover:bg-amber-100 text-muted-foreground hover:text-foreground"
                aria-label="ยกเลิกสมาชิก"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      <Separator />

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center text-muted-foreground">
            <UtensilsCrossed className="mb-3 h-10 w-10 opacity-40" aria-hidden />
            <p className="text-sm">Cart is empty</p>
            <p className="text-xs opacity-70">Tap a product to add it</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const img = getCanteenImage(item.productCode);
              const fb = getCanteenFallback(item.category);
              const FallbackIcon = fb.Icon;
              const unit = unitPriceFor(item);
              const lineTotal = unit * item.quantity;
              return (
                <li
                  key={item.cartLineId}
                  className="flex flex-col gap-1.5 rounded-xl bg-card p-2 border border-amber-100/70"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br",
                        fb.gradient,
                      )}
                    >
                      {img ? (
                        <img
                          src={img}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-amber-900/70">
                          <FallbackIcon className="h-6 w-6" aria-hidden />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold flex items-center gap-1.5">
                        <span className="truncate">{item.name}</span>
                        {item.priceOverride != null && (
                          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                            แก้ราคา
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const current = item.priceOverride ?? (priceMode === "internal" ? item.internalPrice : item.price);
                            const input = window.prompt(
                              `ราคาต่อหน่วยใหม่ (เว้นว่างเพื่อใช้ราคาปกติ)`,
                              String(current),
                            );
                            if (input === null) return;
                            const trimmed = input.trim();
                            if (trimmed === "") {
                              onSetLinePrice(item.cartLineId, null);
                              return;
                            }
                            const parsed = parseFloat(trimmed);
                            if (!isNaN(parsed) && parsed >= 0) {
                              onSetLinePrice(item.cartLineId, parsed);
                            }
                          }}
                          className="inline-flex items-center gap-0.5 rounded hover:bg-muted px-1 py-0.5 -ml-1"
                          aria-label="แก้ราคา"
                        >
                          ฿{unit.toFixed(0)}
                          <Pencil className="h-3 w-3 opacity-60" />
                        </button>
                        <span>·</span>
                        <span className="font-medium text-foreground">
                          ฿{lineTotal.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {item.quantity === 1 ? (
                        <IconButton
                          tooltip={t("canteen.tooltip.removeItem", "ลบออกจากตะกร้า")}
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          onClick={() => onRemove(item.cartLineId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      ) : (
                        <IconButton
                          tooltip={t("canteen.tooltip.qtyDec", "ลดจำนวน")}
                          className="h-8 w-8"
                          onClick={() => onDecrement(item.cartLineId)}
                        >
                          <Minus className="h-4 w-4" />
                        </IconButton>
                      )}
                      <span className="w-6 text-center text-sm font-bold tabular-nums">
                        {item.quantity}
                      </span>
                      <IconButton
                        tooltip={t("canteen.tooltip.qtyInc", "เพิ่มจำนวน")}
                        className="h-8 w-8"
                        onClick={() => onIncrement(item.cartLineId)}
                      >
                        <Plus className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </div>

                  {item.selectedOptions.length > 0 && (
                    <div className="ml-14 text-[11px] text-muted-foreground space-y-0.5">
                      {item.selectedOptions.map((g) =>
                        g.options.map((o) => (
                          <div
                            key={`${g.groupId}-${o.id}`}
                            className="flex justify-between"
                          >
                            <span>
                              {t("canteen.optionLinePrefix")}
                              {o.name}
                              {o.quantity > 1 && ` ×${o.quantity}`}
                            </span>
                            {o.priceDelta > 0 && (
                              <span className="tabular-nums">
                                +฿{(o.priceDelta * o.quantity).toFixed(0)}
                              </span>
                            )}
                          </div>
                        )),
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Separator />

      {/* Summary */}
      <div className="px-5 pt-3 pb-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums">฿{subtotal.toFixed(2)}</span>
        </div>
        {billDiscountAmount > 0 && (
          <div className="flex justify-between text-sm text-emerald-600">
            <button
              type="button"
              onClick={onClearDiscount}
              className="text-left hover:underline"
            >
              Discount ({discountLabel}) ×
            </button>
            <span className="tabular-nums">
              −฿{billDiscountAmount.toFixed(2)}
            </span>
          </div>
        )}
        <Button
          variant="outline"
          onClick={onOpenDiscount}
          disabled={isEmpty}
          className="h-9 w-full border-amber-300 bg-amber-50/70 text-amber-700 hover:bg-amber-100 hover:text-amber-800 font-semibold"
        >
          {discountLabel ? `Add Discount: ${discountLabel}` : "Add Discount"}
        </Button>

        <div className="flex justify-between pt-1 text-xl font-bold">
          <span>Total</span>
          <span className="tabular-nums text-amber-700">
            ฿{total.toFixed(2)}
          </span>
        </div>

        <Button
          className="mt-2 h-14 w-full text-base font-bold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-lg shadow-amber-400/40"
          disabled={isEmpty}
          onClick={onCharge}
        >
          <CreditCard className="mr-2 h-5 w-5" />
          Charge ฿{total.toFixed(2)}
        </Button>
      </div>
    </aside>
  );
}
