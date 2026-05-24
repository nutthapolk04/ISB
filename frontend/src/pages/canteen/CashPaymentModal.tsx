import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banknote, Loader2, ArrowLeft } from "lucide-react";

interface CashPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  onBack: () => void;
  /** Receives the tendered cash amount so the caller can persist it on the receipt. */
  onConfirm: (cashReceived: number) => Promise<void>;
  confirming: boolean;
}

const QUICK_TENDER = [50, 100, 200, 500, 1000];

export function CashPaymentModal({
  open,
  onOpenChange,
  total,
  onBack,
  onConfirm,
  confirming,
}: CashPaymentModalProps) {
  const { t } = useTranslation();
  const [received, setReceived] = useState<string>("");

  useEffect(() => {
    if (open) setReceived("");
  }, [open]);

  const receivedNum = parseFloat(received) || 0;
  const change = receivedNum - total;
  const insufficient = receivedNum > 0 && change < 0;
  const canConfirm = receivedNum >= total && !confirming;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!confirming) onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md canteen-modal-pop">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={onBack}
              className="-ml-2 h-7 w-7"
              aria-label={t("common.back", "Back")}
              disabled={confirming}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Banknote className="h-5 w-5 text-emerald-600" />
            {t("cashPay.title", "Cash Payment")}
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
          <div className="text-xs uppercase text-muted-foreground">
            {t("cashPay.orderTotal", "Order total")}
          </div>
          <div className="text-3xl font-bold tabular-nums text-emerald-700">
            ฿{total.toFixed(2)}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            {t("cashPay.tenderedAmount", "Tendered amount")}
          </label>
          <Input
            type="number"
            inputMode="decimal"
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            placeholder="0.00"
            className="h-14 text-xl font-semibold tabular-nums"
            autoFocus
          />
          <div className="grid grid-cols-5 gap-2">
            {QUICK_TENDER.map((q) => (
              <Button
                key={q}
                variant="outline"
                onClick={() => setReceived(String(q))}
                className="h-11"
              >
                ฿{q}
              </Button>
            ))}
          </div>
          <Button
            variant="secondary"
            onClick={() => setReceived(total.toFixed(2))}
            className="h-11 w-full mt-1 font-semibold"
          >
            {t("cashPay.exactAmount", "Exact amount")} · ฿{total.toFixed(2)}
          </Button>
        </div>

        {receivedNum > 0 && (
          <div className="rounded-xl bg-card border p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("cashPay.received", "Received")}
              </span>
              <span className="tabular-nums">฿{receivedNum.toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t pt-1 text-base font-bold">
              <span>
                {insufficient
                  ? t("cashPay.shortBy", "Short by")
                  : t("cashPay.change", "Change")}
              </span>
              <span
                className={
                  insufficient
                    ? "text-destructive tabular-nums"
                    : "text-emerald-600 tabular-nums"
                }
              >
                ฿{Math.abs(change).toFixed(2)}
              </span>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onBack}
            disabled={confirming}
          >
            {t("common.back", "Back")}
          </Button>
          <Button
            className="flex-1 bg-emerald-500 hover:bg-emerald-600"
            onClick={() => onConfirm(receivedNum)}
            disabled={!canConfirm}
          >
            {confirming ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("cashPay.processing", "Processing…")}
              </>
            ) : (
              t("cashPay.completeSale", "Complete Sale")
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
