import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/IconButton";
import { resolveAvatarUrl, getFallbackAvatar } from "@/lib/avatarFallback";
import { cn } from "@/lib/utils";
import {
    Plus,
    Minus,
    Trash2,
    ScanBarcode,
    Package,
    X,
    Loader2,
    MessageSquare,
} from "lucide-react";
import { DiscountShortcutPopover } from "./DiscountShortcutPopover";
import { BillDiscountPopover } from "./BillDiscountPopover";
import { ReceiptNoteModal } from "./ReceiptNoteModal";
import type { StudentLookupResult } from "@/pages/canteen/RfidPaymentModal";
import type { CartItem, DiscountMode } from "./storeTypes";

interface CartPanelProps {
    asSheet: boolean;
    itemCount: number;
    cart: CartItem[];
    lastAddedId: number | null;
    onClearCart: () => void;
    onUpdateQuantity: (id: number, change: number) => void;
    onRemoveFromCart: (id: number) => void;
    onSetPriceOverride: (id: number, price: number | null) => void;
    onItemDiscountChange: (id: number, value: number | null, mode: DiscountMode) => void;
    onItemDiscountClear: (id: number) => void;
    getPriceForItem: (item: CartItem) => number;
    getItemLineTotal: (item: CartItem) => number;
    preSelectedMember: StudentLookupResult | null;
    onClearMember: () => void;
    subtotal: number;
    billDiscountAmount: number;
    billDiscountValue: string;
    onBillDiscountValueChange: (v: string) => void;
    billDiscountMode: DiscountMode;
    onBillDiscountModeToggle: () => void;
    receiptNote: string;
    noteModalOpen: boolean;
    onNoteModalOpenChange: (open: boolean) => void;
    onSaveNote: (note: string) => void;
    total: number;
    confirming: boolean;
    onCharge: () => void;
}

/** Order/cart panel — reused for the desktop rail and the mobile bottom sheet. */
export function CartPanel({
    asSheet,
    itemCount,
    cart,
    lastAddedId,
    onClearCart,
    onUpdateQuantity,
    onRemoveFromCart,
    onSetPriceOverride,
    onItemDiscountChange,
    onItemDiscountClear,
    getPriceForItem,
    getItemLineTotal,
    preSelectedMember,
    onClearMember,
    subtotal,
    billDiscountAmount,
    billDiscountValue,
    onBillDiscountValueChange,
    billDiscountMode,
    onBillDiscountModeToggle,
    receiptNote,
    noteModalOpen,
    onNoteModalOpenChange,
    onSaveNote,
    total,
    confirming,
    onCharge,
}: CartPanelProps) {
    const { t } = useTranslation();

    return (
        <div className={asSheet ? "canteen-cart-sheet" : "canteen-cart-panel"}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <div>
                    <h2 className="text-base font-bold leading-none">{t("store.order", "Order")}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {t("store.itemCount", { count: itemCount })}
                    </p>
                </div>
                {cart.length > 0 && (
                    <button
                        type="button"
                        onClick={onClearCart}
                        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 transition"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("store.clearAll", "Clear all")}
                    </button>
                )}
            </div>

            {/* Selected Member */}
            {preSelectedMember && (
                <div className="mx-3 mt-3 relative rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-3">
                    <button
                        type="button"
                        onClick={onClearMember}
                        className="absolute right-2 top-2 shrink-0 rounded-full p-1.5 hover:bg-red-100 text-red-500 hover:text-red-600"
                        aria-label={t("common.cancel")}
                    >
                        <X className="h-4 w-4" />
                    </button>
                    <div className="flex items-start gap-3">
                        <div className="flex min-w-0 flex-1 items-center gap-3 pr-6">
                            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full bg-amber-100 ring-2 ring-amber-300">
                                <img
                                    src={resolveAvatarUrl(preSelectedMember.photo_url, preSelectedMember.name || String(preSelectedMember.id))}
                                    alt={preSelectedMember.name}
                                    className="h-full w-full object-cover"
                                    onError={(e) => { e.currentTarget.src = getFallbackAvatar(preSelectedMember.name || String(preSelectedMember.id)); }}
                                />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="font-semibold text-sm truncate">{preSelectedMember.name}</div>
                                <div className="text-xs text-muted-foreground">
                                    {preSelectedMember.student_code ?? preSelectedMember.customer_code}
                                    {preSelectedMember.grade && ` · Grade ${preSelectedMember.grade}`}
                                </div>
                                <div className="text-sm font-bold tabular-nums text-emerald-600">
                                    ฿{(preSelectedMember.wallet_balance ?? 0).toFixed(2)}
                                </div>
                            </div>
                        </div>
                        {/* Daily Spending Limit panel — sits to the right of the member info */}
                        {preSelectedMember.customer_kind !== "department" && preSelectedMember.user_id == null && (() => {
                            const fmt = (n: number) => "฿" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
                            const rows: { label: string; limit: number; spent: number }[] = [];
                            if (preSelectedMember.daily_limit_canteen != null)
                                rows.push({ label: "Canteen", limit: Number(preSelectedMember.daily_limit_canteen), spent: Number(preSelectedMember.spent_today_canteen ?? 0) });
                            if (preSelectedMember.daily_limit_store != null)
                                rows.push({ label: "Store", limit: Number(preSelectedMember.daily_limit_store), spent: Number(preSelectedMember.spent_today_store ?? 0) });
                            if (rows.length === 0) return null;
                            return (
                                <div className="w-48 shrink-0 rounded-lg border border-amber-200 bg-white/60 px-3 py-2 space-y-2">
                                    <div className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                                        Daily Spending Limit
                                    </div>
                                    {rows.map(({ label, limit, spent }) => {
                                        const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
                                        const over = spent >= limit;
                                        const warn = pct >= 80;
                                        const valueColor = over ? "text-red-600" : warn ? "text-amber-600" : "text-amber-500";
                                        const barColor = over ? "bg-red-500" : "bg-amber-500";
                                        return (
                                            <div key={label} className="space-y-1">
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-foreground font-medium">{label}</span>
                                                    <span className={cn("font-bold tabular-nums", valueColor)}>
                                                        {fmt(spent)}{" "}
                                                        <span className="font-normal text-muted-foreground">/ {fmt(limit)}</span>
                                                    </span>
                                                </div>
                                                <div className="w-full h-1.5 rounded-full bg-amber-100 overflow-hidden">
                                                    <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
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

            {/* Cart items */}
            <div className="flex-1 overflow-y-auto">
                {cart.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground py-12">
                        <ScanBarcode className="h-16 w-16 opacity-15" />
                        <p className="text-sm">{t("store.emptyCart")}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-border/40">
                        {cart.map((item) => (
                            <div
                                key={item.id}
                                className={cn(
                                    "px-4 py-3 transition-colors",
                                    item.id === lastAddedId && "bg-primary/5",
                                )}
                            >
                                <div className="flex items-start gap-2.5">
                                    {item.photoUrl ? (
                                        <img
                                            src={item.photoUrl}
                                            alt=""
                                            className="h-10 w-10 rounded object-cover border shrink-0"
                                            loading="lazy"
                                        />
                                    ) : (
                                        <div className="h-10 w-10 rounded bg-muted border flex items-center justify-center shrink-0">
                                            <Package className="h-4 w-4 text-muted-foreground/60" />
                                        </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <p className="font-semibold text-sm leading-snug truncate">{item.name}</p>
                                            {item.quantity < 0 && (
                                                <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                                                    {t("store.refundBadge", "Refund")}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[10px] text-muted-foreground font-mono">{item.barcode}</p>
                                        <div className="flex items-center justify-between mt-1.5">
                                            <div className="flex items-center gap-1">
                                                <IconButton
                                                    tooltip={t("store.tooltip.qtyDec")}
                                                    variant="outline"
                                                    className="h-6 w-6"
                                                    onClick={() => onUpdateQuantity(item.id, -1)}
                                                >
                                                    <Minus className="h-3 w-3" />
                                                </IconButton>
                                                <span className={cn(
                                                    "w-7 text-center text-sm font-bold tabular-nums",
                                                    item.quantity < 0 && "text-rose-600",
                                                )}>
                                                    {item.quantity}
                                                </span>
                                                <IconButton
                                                    tooltip={t("store.tooltip.qtyInc")}
                                                    variant="outline"
                                                    className="h-6 w-6"
                                                    onClick={() => onUpdateQuantity(item.id, 1)}
                                                >
                                                    <Plus className="h-3 w-3" />
                                                </IconButton>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const current = getPriceForItem(item);
                                                    const input = window.prompt(
                                                        t("store.priceOverridePrompt"),
                                                        String(current),
                                                    );
                                                    if (input === null) return;
                                                    const trimmed = input.trim();
                                                    if (trimmed === "") {
                                                        onSetPriceOverride(item.id, null);
                                                        return;
                                                    }
                                                    const parsed = parseFloat(trimmed);
                                                    if (!isNaN(parsed) && parsed >= 0) {
                                                        onSetPriceOverride(item.id, parsed);
                                                    }
                                                }}
                                                className="text-xs tabular-nums hover:underline"
                                            >
                                                ฿{getPriceForItem(item).toLocaleString()}
                                                {item.priceOverride != null && (
                                                    <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-900">
                                                        {t("store.priceEdited", "แก้ไข")}
                                                    </span>
                                                )}
                                            </button>
                                        </div>
                                        {/* Line discount row */}
                                        <div className="flex items-center justify-between mt-1.5 text-xs">
                                            <div className="flex items-center gap-1">
                                                <span className="text-muted-foreground">
                                                    {t("store.tableDiscount", "ส่วนลด")}:
                                                </span>
                                                {(item.discountValue ?? 0) > 0 && (
                                                    <span className="text-xs font-semibold text-amber-700">
                                                        −{item.discountValue}{item.discountMode === "percent" ? "%" : "฿"}
                                                    </span>
                                                )}
                                                <DiscountShortcutPopover
                                                    itemId={item.id}
                                                    currentValue={item.discountValue}
                                                    currentMode={item.discountMode}
                                                    onUpdate={onItemDiscountChange}
                                                />
                                                {(item.discountValue ?? 0) > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onItemDiscountClear(item.id)}
                                                        className="h-5 px-1 text-[10px] text-destructive rounded hover:bg-destructive/10"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                )}
                                            </div>
                                            <span className="font-bold text-primary tabular-nums">
                                                ฿{getItemLineTotal(item).toLocaleString()}
                                            </span>
                                        </div>
                                    </div>
                                    <IconButton
                                        tooltip={t("store.tooltip.removeItem")}
                                        className="h-6 w-6 shrink-0"
                                        onClick={() => onRemoveFromCart(item.id)}
                                    >
                                        <Trash2 className="h-3 w-3 text-destructive" />
                                    </IconButton>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer — always shown (Charge button disabled when cart empty) */}
            <div className="border-t border-border/60 px-5 py-5 space-y-3">
                {/* Subtotal */}
                <div className="flex justify-between items-baseline text-base text-muted-foreground">
                    <span>{t("store.subtotal", "ยอดรวม")}</span>
                    <span className="tabular-nums font-semibold text-foreground">฿{subtotal.toLocaleString()}</span>
                </div>

                {/* Bill discount row (shown when active) */}
                {billDiscountAmount > 0 && (
                    <div className="flex justify-between text-base text-destructive">
                        <span>{t("store.billDiscount")}</span>
                        <span className="tabular-nums font-semibold">-฿{billDiscountAmount.toLocaleString()}</span>
                    </div>
                )}

                {/* Note + Add Discount — side by side */}
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => onNoteModalOpenChange(true)}
                        className={cn(
                            "flex-1 h-9 rounded-xl border text-sm font-semibold transition flex items-center justify-center gap-1.5 relative",
                            receiptNote ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100" : "border-border hover:bg-muted",
                        )}
                    >
                        <MessageSquare className="h-4 w-4" />
                        {t("store.receiptNoteLabel", "Note")}
                        {receiptNote && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-blue-500" />}
                    </button>

                    <BillDiscountPopover
                        disabled={cart.length === 0}
                        value={billDiscountValue}
                        onValueChange={onBillDiscountValueChange}
                        mode={billDiscountMode}
                        onModeToggle={onBillDiscountModeToggle}
                        amount={billDiscountAmount}
                    />
                </div>

                <ReceiptNoteModal
                    open={noteModalOpen}
                    onOpenChange={onNoteModalOpenChange}
                    initialNote={receiptNote}
                    onSave={onSaveNote}
                />

                {/* Total */}
                <div className="flex justify-between items-baseline pt-2">
                    <span className="text-lg font-bold">{t("store.tableTotal")}</span>
                    <span className="text-3xl font-extrabold text-primary tabular-nums">
                        ฿{total.toLocaleString()}
                    </span>
                </div>

                {/* Charge button */}
                <Button
                    onClick={onCharge}
                    disabled={cart.length === 0 || confirming}
                    className="mt-2 w-full h-16 text-lg font-extrabold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-lg shadow-amber-400/40"
                >
                    {confirming ? (
                        <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                        `${t("store.charge", "Charge")} ฿${total.toLocaleString()}`
                    )}
                </Button>
            </div>
        </div>
    );
}
