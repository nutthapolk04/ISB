import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DiscountMode } from "./storeTypes";

// ── Per-item discount shortcut popover (same UX as canteen) ─────────────────
const DISCOUNT_SHORTCUTS_PCT = [5, 10, 15, 20, 25, 30];
const DISCOUNT_SHORTCUTS_AMT = [5, 10, 15, 20, 25];

export function DiscountShortcutPopover({
    itemId,
    currentValue,
    currentMode,
    onUpdate,
}: {
    itemId: number;
    currentValue: number | undefined;
    currentMode: DiscountMode | undefined;
    onUpdate: (id: number, value: number | null, mode: DiscountMode) => void;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    // Local mode lets the user toggle %↔฿ inside the popover without saving
    // a stale discount. Resets to the persisted mode each time the popover opens.
    const [localMode, setLocalMode] = useState<DiscountMode>(currentMode ?? "percent");
    useEffect(() => {
        if (open) setLocalMode(currentMode ?? "percent");
    }, [open, currentMode]);
    const mode = localMode;
    const shortcuts = mode === "percent" ? DISCOUNT_SHORTCUTS_PCT : DISCOUNT_SHORTCUTS_AMT;

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
                >
                    {mode === "percent" ? "%" : "฿"}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-4" align="start" side="top" sideOffset={6}>
                <p className="mb-3 text-sm font-semibold text-muted-foreground">
                    {t("store.cart.discountHeader")} {mode === "percent" ? "%" : "฿"}
                </p>
                <div className="grid grid-cols-3 gap-2">
                    {shortcuts.map((q) => (
                        <button
                            key={q}
                            type="button"
                            onClick={() => { onUpdate(itemId, q, mode); setOpen(false); }}
                            className={cn(
                                "h-12 min-w-[4.5rem] rounded-lg border text-base font-bold transition-colors",
                                currentValue === q && currentMode === mode
                                    ? "border-amber-500 bg-amber-500 text-white"
                                    : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
                            )}
                        >
                            {mode === "percent" ? `${q}%` : `฿${q}`}
                        </button>
                    ))}
                </div>
                <div className="mt-3 flex gap-2">
                    <button
                        type="button"
                        onClick={() => { onUpdate(itemId, null, mode); setOpen(false); }}
                        className="flex-1 h-10 rounded-lg border border-border bg-background text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                    >
                        Clear / 0
                    </button>
                    <button
                        type="button"
                        onClick={() => setLocalMode(mode === "percent" ? "amount" : "percent")}
                        className="h-10 px-4 rounded-lg border border-border bg-background text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                    >
                        {mode === "percent" ? t("store.cart.useBaht") : t("store.cart.usePercent")}
                    </button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
