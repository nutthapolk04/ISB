import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CanteenProduct } from "@/hooks/useCanteenCart";

interface SpecialItemPriceDialogProps {
  product: CanteenProduct | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (product: CanteenProduct, price: number, qty: number) => void;
}

/** Special item (price=0) — cashier must enter price (and optionally quantity) before adding. */
export function SpecialItemPriceDialog({ product, onOpenChange, onConfirm }: SpecialItemPriceDialogProps) {
  const { t } = useTranslation();
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPrice("");
    setQty("1");
  }, [product]);

  const parsedQty = parseInt(qty, 10);
  const qtyValid = Number.isInteger(parsedQty) && parsedQty >= 1;

  const confirm = () => {
    const parsed = parseFloat(price);
    if (!isNaN(parsed) && parsed >= 0 && qtyValid && product) {
      onConfirm(product, parsed, parsedQty);
    }
  };

  return (
    <Dialog
      open={!!product}
      onOpenChange={(o) => { if (!o) onOpenChange(false); }}
    >
      <DialogContent
        className="sm:max-w-xs"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("canteen.pos.setPrice")}</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <p className="text-sm text-muted-foreground">
            {product?.name} — {t("canteen.pos.enterPriceHint")}
          </p>
          <Input
            ref={inputRef}
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm();
            }}
            className="text-lg text-right tabular-nums"
          />
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">{t("canteen.pos.quantityLabel", "Quantity")}</label>
            <Input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirm();
              }}
              className="text-right tabular-nums"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={confirm}
            disabled={isNaN(parseFloat(price)) || parseFloat(price) < 0 || !qtyValid}
            className="bg-gradient-to-r from-amber-500 to-orange-500 text-white"
          >
            {t("canteen.addToCart")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
