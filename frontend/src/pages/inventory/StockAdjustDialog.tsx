import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Product } from "./inventoryTypes";

const ADJUSTMENT_REASONS = [
  "Receive stock",
  "Return from customer",
  "Damage / write-off",
  "Manual adjustment",
  "Stock count correction",
  "Other",
] as const;

interface StockAdjustDialogProps {
  product: Product | null;
  onOpenChange: (open: boolean) => void;
  shopType: "avg_cost" | "fifo";
  onAdjusted: () => void;
}

export function StockAdjustDialog({ product, onOpenChange, shopType, onAdjusted }: StockAdjustDialogProps) {
  const { t } = useTranslation();
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustCost, setAdjustCost] = useState("");

  useEffect(() => {
    setAdjustQty("");
    setAdjustReason("");
    setAdjustCost("");
  }, [product]);

  const handleAdjustStock = async () => {
    if (!product) return;
    const delta = parseInt(adjustQty);
    if (isNaN(delta) || delta === 0) {
      toast.error(t("inventory.errorNonZeroQty"));
      return;
    }
    if (!adjustReason) {
      toast.error(t("inventory.errorSelectReason"));
      return;
    }
    try {
      await api.post(`/shops/${product.subMerchantId}/adjust`, {
        product_id: product.id,
        delta,
        reason: adjustReason,
        cost_per_unit: adjustCost ? parseFloat(adjustCost) : undefined,
      });
      const sign = delta > 0 ? "+" : "";
      toast.success(`${product.name}: ${sign}${delta}`);
      onOpenChange(false);
      onAdjusted();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to adjust stock");
    }
  };

  return (
    <Dialog open={!!product} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("inventory.adjustStock")}</DialogTitle>
          <DialogDescription>
            {product?.name} — {t("inventory.previewCurrentStock")}:{" "}
            {product?.stock}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>{t("inventory.adjustmentQuantity")}</Label>
            {/* Quick shortcut buttons */}
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {[-10, -5, -1, +1, +5, +10].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAdjustQty(String((parseInt(adjustQty) || 0) + v))}
                  className={`h-8 min-w-[2.75rem] rounded-lg border text-xs font-bold transition-colors ${
                    v < 0
                      ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                      : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                  }`}
                >
                  {v > 0 ? `+${v}` : v}
                </button>
              ))}
            </div>
            <Input
              type="number"
              value={adjustQty}
              onChange={(e) => setAdjustQty(e.target.value)}
              placeholder="+10 or -5"
              autoFocus
            />
            {/* Preview new stock */}
            {adjustQty !== "" && !isNaN(parseInt(adjustQty)) && parseInt(adjustQty) !== 0 && product && (
              <p className="text-xs mt-1">
                <span className="text-muted-foreground">{t("inventory.previewCurrentStock")}: {product.stock}</span>
                {" → "}
                <span className={`font-semibold ${product.stock + parseInt(adjustQty) < 0 ? "text-amber-600" : "text-green-700"}`}>
                  {product.stock + parseInt(adjustQty)}
                </span>
              </p>
            )}
          </div>
          {shopType === "fifo" && parseInt(adjustQty) > 0 && (
            <div>
              <Label>{t("inventory.adjustCostLabel")}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={adjustCost}
                onChange={(e) => setAdjustCost(e.target.value)}
                placeholder={t("inventory.adjustCostPlaceholder")}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("inventory.adjustCostHint")}
              </p>
            </div>
          )}
          <div>
            <Label>{t("inventory.adjustmentReason")}</Label>
            <Select value={adjustReason} onValueChange={setAdjustReason}>
              <SelectTrigger>
                <SelectValue placeholder={t("inventory.selectProductPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {ADJUSTMENT_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("inventory.cancel")}
          </Button>
          <Button onClick={handleAdjustStock}>{t("inventory.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
