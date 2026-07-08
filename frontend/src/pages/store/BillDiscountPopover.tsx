import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DiscountMode } from "./storeTypes";

interface BillDiscountPopoverProps {
    disabled: boolean;
    value: string;
    onValueChange: (v: string) => void;
    mode: DiscountMode;
    onModeToggle: () => void;
    amount: number;
}

/** Whole-bill discount popover in the cart footer. */
export function BillDiscountPopover({ disabled, value, onValueChange, mode, onModeToggle, amount }: BillDiscountPopoverProps) {
    const { t } = useTranslation();

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    className={cn(
                        "flex-1 h-9 rounded-xl border text-sm font-semibold transition",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                        amount > 0
                            ? "border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-100"
                            : "border-amber-400 text-amber-600 hover:bg-amber-50",
                    )}
                >
                    {amount > 0
                        ? `${t("store.billDiscount")} · -฿${amount.toLocaleString()}`
                        : t("store.addDiscount", "Add Discount")}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3 space-y-3" side="top">
                <p className="text-xs font-semibold text-muted-foreground">{t("store.billDiscount")}</p>
                <div className="flex items-center gap-2">
                    <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={value}
                        onChange={(e) => onValueChange(e.target.value)}
                        className="h-9 text-right text-sm flex-1"
                    />
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-9 px-3 font-bold shrink-0"
                        onClick={onModeToggle}
                    >
                        {mode === "percent" ? "%" : "฿"}
                    </Button>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                    {(mode === "percent" ? [5, 10, 15, 20] : [10, 20, 50, 100]).map((q) => (
                        <button
                            key={q}
                            type="button"
                            onClick={() => onValueChange(String(q))}
                            className={cn(
                                "h-9 rounded-lg border text-xs font-semibold transition",
                                parseFloat(value) === q
                                    ? "border-amber-500 bg-amber-500 text-white"
                                    : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
                            )}
                        >
                            {mode === "percent" ? `${q}%` : `฿${q}`}
                        </button>
                    ))}
                </div>
                {amount > 0 && (
                    <button
                        type="button"
                        onClick={() => onValueChange("")}
                        className="w-full h-8 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted transition"
                    >
                        Clear
                    </button>
                )}
            </PopoverContent>
        </Popover>
    );
}
