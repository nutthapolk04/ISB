import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BillDiscountMode } from "@/hooks/useCanteenCart";

interface DiscountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtotal: number;
  initialMode: BillDiscountMode;
  initialValue: number;
  onApply: (mode: BillDiscountMode, value: number) => void;
  onClear: () => void;
}

const QUICK_PERCENT = [5, 10, 15, 20];
const QUICK_AMOUNT = [10, 20, 50, 100];

export function DiscountModal({
  open,
  onOpenChange,
  subtotal,
  initialMode,
  initialValue,
  onApply,
  onClear,
}: DiscountModalProps) {
  const [mode, setMode] = useState<BillDiscountMode>(initialMode);
  const [value, setValue] = useState<string>(
    initialValue > 0 ? String(initialValue) : "",
  );

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setValue(initialValue > 0 ? String(initialValue) : "");
    }
  }, [open, initialMode, initialValue]);

  const numericValue = parseFloat(value) || 0;
  const previewDiscount =
    mode === "percent"
      ? Math.min((subtotal * numericValue) / 100, subtotal)
      : Math.min(numericValue, subtotal);
  const newTotal = Math.max(0, subtotal - previewDiscount);

  const quickButtons = mode === "percent" ? QUICK_PERCENT : QUICK_AMOUNT;

  const handleApply = () => {
    onApply(mode, numericValue);
    onOpenChange(false);
  };

  const handleClear = () => {
    onClear();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md canteen-modal-pop">
        <DialogHeader>
          <DialogTitle>Apply Discount</DialogTitle>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
          {(["percent", "amount"] as BillDiscountMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-lg py-2 text-sm font-semibold transition",
                mode === m
                  ? "bg-white shadow text-amber-700"
                  : "text-muted-foreground",
              )}
            >
              {m === "percent" ? "Percentage (%)" : "Amount (฿)"}
            </button>
          ))}
        </div>

        {/* Quick picks */}
        <div className="grid grid-cols-4 gap-2">
          {quickButtons.map((q) => (
            <Button
              key={q}
              variant="outline"
              onClick={() => setValue(String(q))}
              className={cn(
                "h-12 font-semibold",
                numericValue === q &&
                  "border-amber-500 bg-amber-50 text-amber-700",
              )}
            >
              {mode === "percent" ? `${q}%` : `฿${q}`}
            </Button>
          ))}
        </div>

        {/* Manual input */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Custom {mode === "percent" ? "percentage" : "amount"}
          </label>
          <div className="relative">
            <Input
              type="number"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0"
              className="h-12 text-lg font-semibold"
              min={0}
              max={mode === "percent" ? 100 : subtotal}
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              {mode === "percent" ? "%" : "฿"}
            </span>
          </div>
        </div>

        {/* Preview */}
        <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">฿{subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-emerald-600">
            <span>Discount</span>
            <span className="tabular-nums">−฿{previewDiscount.toFixed(2)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-amber-200 pt-1 font-bold">
            <span>New Total</span>
            <span className="tabular-nums text-amber-700">
              ฿{newTotal.toFixed(2)}
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {initialValue > 0 && (
            <Button variant="ghost" onClick={handleClear}>
              Remove
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={numericValue <= 0}
            className="bg-amber-500 hover:bg-amber-600"
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
