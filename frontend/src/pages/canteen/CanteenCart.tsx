import { useEffect, useState, type ReactNode } from "react";
import { Minus, Plus, Trash2, CreditCard, UtensilsCrossed, Pencil, X, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/IconButton";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatBahtAmount } from "@/lib/format";
import { resolveAvatarUrl, getFallbackAvatar } from "@/lib/avatarFallback";
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
  /** Optional cashier note attached to the receipt — mirrors the Store cart
   *  so canteen cashiers can flag a memo (e.g. "free meal", "guest order")
   *  without leaving the cart. */
  note?: string;
  onNoteChange?: (value: string) => void;
  /** When rendered inside a mobile Sheet, suppress the aside-style panel chrome. */
  asSheet?: boolean;
  /** Pre-selected member for payment */
  selectedMember?: StudentLookupResult | null;
  /** Clear the selected member */
  onClearMember?: () => void;
  /** Optional slot rendered above the cart header (e.g. spending limit chip) */
  headerSlot?: ReactNode;
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
  note = "",
  onNoteChange,
  asSheet = false,
  selectedMember,
  onClearMember,
  headerSlot,
}: CanteenCartProps) {
  const { t } = useTranslation();
  const isEmpty = items.length === 0;
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [localNote, setLocalNote] = useState("");
  const discountLabel =
    billDiscountValue > 0
      ? billDiscountMode === "percent"
        ? `${billDiscountValue}%`
        : `฿${formatBahtAmount(billDiscountValue)}`
      : null;

  return (
    <aside className={asSheet ? "canteen-cart-sheet" : "canteen-cart-panel"}>
      {/* Spending limit chip slot (injected by Canteen.tsx) */}
      {/* {headerSlot && <div className="px-3 pt-3">{headerSlot}</div>} */}

      {/* Header */}
      

      {/* Selected Member */}
      {selectedMember && (
        <div className="mx-3 mb-2 relative rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-3">
          {onClearMember && (
            <button
              type="button"
              onClick={onClearMember}
              className="absolute right-2 top-2 shrink-0 rounded-full p-1.5 hover:bg-red-100 text-red-500 hover:text-red-600"
              aria-label={t("canteen.cart.clearMemberAria")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3 pr-6">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full bg-amber-100 ring-2 ring-amber-300">
                <img
                  src={resolveAvatarUrl(selectedMember.photo_url, selectedMember.name || String(selectedMember.id))}
                  alt={selectedMember.name}
                  className="h-full w-full object-cover"
                  onError={(e) => { e.currentTarget.src = getFallbackAvatar(selectedMember.name || String(selectedMember.id)); }}
                />
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
            </div>
            {/* Daily Spending Limit panel — sits to the right of the member info */}
            {selectedMember.customer_kind !== "department" && selectedMember.user_id == null && (() => {
              const fmt = (n: number) => "฿" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
              const rows: { label: string; limit: number; spent: number }[] = [];
              if (selectedMember.daily_limit_canteen != null)
                rows.push({ label: "Canteen", limit: Number(selectedMember.daily_limit_canteen), spent: Number(selectedMember.spent_today_canteen ?? 0) });
              if (selectedMember.daily_limit_store != null)
                rows.push({ label: "Store", limit: Number(selectedMember.daily_limit_store), spent: Number(selectedMember.spent_today_store ?? 0) });
              if (rows.length === 0) return null;
              return (
                <div className="w-48 shrink-0 rounded-lg border border-amber-200 bg-white/60 px-3 py-2 space-y-2">
                  <div className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                    Daily Spending remaining / limit
                  </div>
                  {rows.map(({ label, limit, spent }) => {
                    const remaining = Math.max(0, limit - spent);
                    const remainingPct = limit > 0 ? Math.max(0, (remaining / limit) * 100) : 100;
                    const over = spent >= limit;
                    const warn = remainingPct <= 20 && !over;
                    const valueColor = over ? "text-red-600" : warn ? "text-amber-600" : "text-emerald-700";
                    return (
                      <div key={label} className="space-y-1">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-foreground font-medium">{label}</span>
                          <span className={cn("font-bold tabular-nums", valueColor)}>
                            {fmt(remaining)}{" "}
                            <span className="font-normal text-muted-foreground">/ {fmt(limit)}</span>
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${remainingPct}%`, backgroundColor: `hsl(${remainingPct * 1.2}, 75%, 45%)` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}
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
                        !item.color && fb.gradient,
                      )}
                      style={item.color ? { backgroundColor: item.color } : undefined}
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
                        {item.quantity < 0 && (
                          <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                            {t("store.refundBadge", "Refund")}
                          </span>
                        )}
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
                          ฿{formatBahtAmount(unit)}
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
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <IconButton
                          tooltip={t("canteen.tooltip.qtyDec", "ลดจำนวน")}
                          variant="outline"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onDecrement(item.cartLineId);
                          }}
                        >
                          <Minus className="h-3 w-3" />
                        </IconButton>
                        <span className={cn("w-7 text-center text-sm font-bold tabular-nums", item.quantity < 0 && "text-rose-600")}>
                          {item.quantity}
                        </span>
                        <IconButton
                          tooltip={t("canteen.tooltip.qtyInc", "เพิ่มจำนวน")}
                          variant="outline"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onIncrement(item.cartLineId);
                          }}
                        >
                          <Plus className="h-3 w-3" />
                        </IconButton>
                      </div>
                      <IconButton
                        tooltip={t("canteen.tooltip.removeItem", "ลบออกจากตะกร้า")}
                        className="h-6 w-6 shrink-0"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onRemove(item.cartLineId);
                        }}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
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
                                +฿{formatBahtAmount(o.priceDelta * o.quantity)}
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
        <div className="flex gap-2">
          {onNoteChange && (
            <Button
              variant="outline"
              onClick={() => { setLocalNote(note); setNoteModalOpen(true); }}
              className={cn(
                "flex-1 h-9 rounded-xl relative gap-1.5 text-sm",
                note ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100" : ""
              )}
            >
              <MessageSquare className="h-4 w-4" />
              {t("canteen.receiptNoteLabel", "Note")}
              {note && (
                <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-blue-500" />
              )}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={onOpenDiscount}
            disabled={isEmpty}
            className="flex-1 h-9 rounded-xl border-amber-300 bg-amber-50/70 text-amber-700 hover:bg-amber-100 hover:text-amber-800 font-semibold text-sm"
          >
            {discountLabel ? `Add Discount: ${discountLabel}` : "Add Discount"}
          </Button>
        </div>

        {/* Note modal */}
        {onNoteChange && (
          <Dialog open={noteModalOpen} onOpenChange={setNoteModalOpen}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>{t("canteen.receiptNoteLabel", "Note")}</DialogTitle>
              </DialogHeader>
              <Textarea
                placeholder={t("canteen.receiptNote", "Add a note to this receipt (optional)")}
                value={localNote}
                onChange={(e) => setLocalNote(e.target.value)}
                rows={4}
                maxLength={200}
                autoFocus
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setNoteModalOpen(false)}>
                  {t("common.cancel", "Cancel")}
                </Button>
                <Button onClick={() => { onNoteChange(localNote); setNoteModalOpen(false); }}>
                  {t("common.save", "Save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

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
