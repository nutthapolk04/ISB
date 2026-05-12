import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QrCode, Loader2, ArrowLeft } from "lucide-react";

interface QrPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  onBack: () => void;
  onConfirm: () => Promise<void>;
  confirming: boolean;
}

export function QrPaymentModal({
  open,
  onOpenChange,
  total,
  onBack,
  onConfirm,
  confirming,
}: QrPaymentModalProps) {
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
              aria-label="Back"
              disabled={confirming}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <QrCode className="h-5 w-5 text-indigo-500" />
            QR PromptPay
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          <div className="flex h-48 w-48 items-center justify-center rounded-2xl border-4 border-dashed border-indigo-200 bg-gradient-to-br from-indigo-50 to-sky-50">
            <QrCode className="h-32 w-32 text-indigo-400" strokeWidth={1.2} />
          </div>
          <div className="text-center">
            <div className="text-xs uppercase text-muted-foreground">
              Scan to pay
            </div>
            <div className="text-3xl font-bold tabular-nums text-indigo-700">
              ฿{total.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onBack}
            disabled={confirming}
          >
            Back
          </Button>
          <Button
            className="flex-1 bg-indigo-500 hover:bg-indigo-600"
            onClick={onConfirm}
            disabled={confirming}
          >
            {confirming ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing…
              </>
            ) : (
              "Mark as Paid"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
