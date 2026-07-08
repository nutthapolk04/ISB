import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Product } from "./storeTypes";

interface SpecialItemPriceDialogProps {
    product: Product | null;
    onOpenChange: (open: boolean) => void;
    onConfirm: (product: Product, price: number) => void;
}

/** Special item (price=0) — cashier must enter price before adding to the Store cart. */
export function SpecialItemPriceDialog({ product, onOpenChange, onConfirm }: SpecialItemPriceDialogProps) {
    const { t } = useTranslation();
    const [price, setPrice] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setPrice("");
    }, [product]);

    const confirm = () => {
        const parsed = parseFloat(price);
        if (!isNaN(parsed) && parsed >= 0 && product) {
            onConfirm(product, parsed);
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
                    <DialogTitle>{t("store.setPrice")}</DialogTitle>
                </DialogHeader>
                <div className="py-2 space-y-3">
                    <p className="text-sm text-muted-foreground">
                        {product?.name} — {t("store.enterSellPrice")}
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
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t("common.cancel")}
                    </Button>
                    <Button
                        onClick={confirm}
                        disabled={isNaN(parseFloat(price)) || parseFloat(price) < 0}
                        className="bg-gradient-to-r from-amber-500 to-orange-500 text-white"
                    >
                        {t("store.addToCart")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
