import { useEffect, useState } from "react";
import { Minus, Plus, Trash2, CreditCard, UtensilsCrossed, Pencil, UserCircle2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/IconButton";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getCanteenImage, getCanteenFallback } from "./canteenImages";
import type {
  CanteenCartItem,
  BillDiscountMode,
  LineDiscountMode,
  PriceMode,
} from "@/hooks/useCanteenCart";
import type { StudentLookupResult } from "./RfidPaymentModal";

const DISCOUNT_SHORTCUTS_PCT = [5, 10, 15, 20, 25, 30];
const DISCOUNT_SHORTCUTS_AMT = [5, 10, 15, 20, 25];

function DiscountShortcutPopover({
  cartLineId,
  currentValue,
  currentMode,
  onSetLineDiscount,
}: {
  cartLineId: string;
  currentValue: number | undefined;
  currentMode: LineDiscountMode | undefined;
  onSetLineDiscount: (id: string, value: number | null, mode: LineDiscountMode) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Local mode lets the user toggle %↔฿ inside the popover without saving
  // a stale discount. Resets to the persisted mode each time the popover opens.
  const [localMode, setLocalMode] = useState<LineDiscountMode>(currentMode ?? "percent");
  useEffect(() => {
    if (open) setLocalMode(currentMode ?? "percent");
  }, [open, currentMode]);
  const mode = localMode;
  const shortcuts = mode === "percent" ? DISCOUNT_SHORTCUTS_PCT : DISCOUNT_SHORTCUTS_AMT;

  const handleShortcut = (q: number) => {
    onSetLineDiscount(cartLineId, q, mode);
    setOpen(false);
  };

  const handleClear = () => {
    onSetLineDiscount(cartLineId, null, mode);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "h-7 px-2.5 text-xs font-bold rounded border bg-background transition-colors",
            mode === "percent"
              ? "border-amber-400 text-amber-700 hover:bg-amber-50"
              : "border-border text-foreground hover:bg-muted",
          )}
          aria-label={t("canteen.cart.selectDiscountAria")}
        >
          {mode === "percent" ? "%" : "฿"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-4"
        align="start"
        side="top"
        sideOffset={6}
      >
        <p className="mb-3 text-sm font-semibold text-muted-foreground">
          {t("canteen.cart.discountHeader")} {mode === "percent" ? "%" : "฿"}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {shortcuts.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => handleShortcut(q)}
              className={cn(
                "h-12 w-full rounded-xl border text-base font-bold transition-colors",
                currentValue === q && (currentMode ?? "percent") === mode
                  ? "border-amber-500 bg-amber-500 text-white"
                  : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 active:bg-amber-200",
              )}
            >
              {mode === "percent" ? `${q}%` : `฿${q}`}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={handleClear}
            className="flex-1 h-10 rounded-xl border border-border bg-background text-sm font-medium text-muted-foreground hover:bg-muted active:bg-muted/80 transition-colors"
          >
            Clear / 0
          </button>
          <button
            type="button"
            onClick={() => setLocalMode(mode === "percent" ? "amount" : "percent")}
            className="h-10 px-4 rounded-xl border border-border bg-background text-sm font-medium text-muted-foreground hover:bg-muted active:bg-muted/80 transition-colors"
          >
            {mode === "percent" ? t("canteen.cart.useBaht") : t("canteen.cart.usePercent")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

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
  /** Per-line discount. pass null value to clear. */
  onSetLineDiscount: (cartLineId: string, value: number | null, mode: LineDiscountMode) => void;
  /** Computed discount amount (฿) for a single line. */
  lineDiscountAmountFor: (item: CanteenCartItem) => number;
  onOpenDiscount: () => void;
  onClearDiscount: () => void;
  onClearCart: () => void;
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
  onSetLineDiscount,
  lineDiscountAmountFor,
  onOpenDiscount,
  onClearDiscount,
  onClearCart,
  onCharge,
  asSheet = false,
  selectedMember,
  onClearMember,
}: CanteenCartProps) {
  const { t } = useTranslation();
  const isEmpty = items.length === 0;
  const discountLabel =
    billDiscountValue > 0
      ? billDiscountMode === "percent"
        ? `${billDiscountValue}%`
        : `฿${billDiscountValue.toFixed(0)}`
      : null;

  return (
    <aside className={asSheet ? "canteen-cart-sheet" : "canteen-cart-panel"}>
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex items-start justify-between">
        <div>
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
        {!isEmpty && (
          <button
            type="button"
            onClick={onClearCart}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
            aria-label="Clear all items"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear all
          </button>
        )}
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
                aria-label={t("canteen.cart.clearMemberAria")}
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
              const lineDisc = lineDiscountAmountFor(item);
              const lineTotal = Math.max(0, unit * item.quantity - lineDisc);
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
                            {t("canteen.cart.editedBadge")}
                          </span>
                        )}
                        {(item.lineDiscountValue ?? 0) > 0 && (
                          <span className="shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">
                            {t("canteen.cart.discountBadge", {
                              value:
                                item.lineDiscountMode === "amount"
                                  ? `฿${item.lineDiscountValue}`
                                  : `${item.lineDiscountValue}%`,
                            })}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const current = item.priceOverride ?? (priceMode === "internal" ? item.internalPrice : item.price);
                            const input = window.prompt(
                              t("canteen.cart.newUnitPricePrompt"),
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
                          aria-label={t("canteen.cart.editPriceAria")}
                        >
                          ฿{unit.toFixed(0)}
                          <Pencil className="h-3 w-3 opacity-60" />
                        </button>
                        <span>·</span>
                        <span className="font-medium text-foreground">
                          ฿{lineTotal.toFixed(2)}
                        </span>
                      </div>
                      {/* Per-item discount row */}
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-muted-foreground">{t("canteen.cart.discountLabel")}:</span>
                        {(item.lineDiscountValue ?? 0) > 0 && (
                          <span className="text-xs font-semibold text-amber-700 tabular-nums">
                            −{item.lineDiscountMode === "percent"
                              ? `${item.lineDiscountValue}%`
                              : `฿${item.lineDiscountValue}`}
                          </span>
                        )}
                        <DiscountShortcutPopover
                          cartLineId={item.cartLineId}
                          currentValue={item.lineDiscountValue}
                          currentMode={item.lineDiscountMode}
                          onSetLineDiscount={onSetLineDiscount}
                        />
                        {(item.lineDiscountValue ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => onSetLineDiscount(item.cartLineId, null, item.lineDiscountMode ?? "percent")}
                            className="h-5 px-1 text-[10px] text-destructive rounded hover:bg-destructive/10"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
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
      <div className="px-5 pt-4 pb-5 space-y-3">
        <div className="flex justify-between items-baseline text-base">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums font-semibold">฿{subtotal.toFixed(2)}</span>
        </div>
        {billDiscountAmount > 0 && (
          <div className="flex justify-between text-base text-emerald-600">
            <button
              type="button"
              onClick={onClearDiscount}
              className="text-left hover:underline font-medium"
            >
              Discount ({discountLabel}) ×
            </button>
            <span className="tabular-nums font-semibold">
              −฿{billDiscountAmount.toFixed(2)}
            </span>
          </div>
        )}
        <Button
          variant="outline"
          onClick={onOpenDiscount}
          disabled={isEmpty}
          className="h-12 w-full border-amber-300 bg-amber-50/70 text-amber-700 hover:bg-amber-100 hover:text-amber-800 font-semibold text-base"
        >
          {discountLabel ? `Add Discount: ${discountLabel}` : "Add Discount"}
        </Button>

        <div className="flex justify-between items-baseline pt-2">
          <span className="text-lg font-bold">Total</span>
          <span className="tabular-nums text-3xl font-extrabold text-amber-700">
            ฿{total.toFixed(2)}
          </span>
        </div>

        <Button
          className="mt-2 h-16 w-full text-lg font-extrabold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-lg shadow-amber-400/40"
          disabled={isEmpty}
          onClick={onCharge}
        >
          <CreditCard className="mr-2 h-6 w-6" />
          Charge ฿{total.toFixed(2)}
        </Button>
      </div>
    </aside>
  );
}
