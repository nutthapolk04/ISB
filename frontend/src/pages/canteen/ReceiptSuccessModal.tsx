import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UserRound } from "lucide-react";

interface ReceiptSuccessModalProps {
  open: boolean;
  onClose: () => void;
  receiptNumber: string;
  amount: number;
  remainingBalance: number | null;
  studentName?: string | null;
  studentPhotoUrl?: string | null;
  studentGrade?: string | null;
  autoCloseMs?: number;
}

export function ReceiptSuccessModal({
  open,
  onClose,
  receiptNumber,
  amount,
  remainingBalance,
  studentName,
  studentPhotoUrl,
  studentGrade,
  autoCloseMs = 2000,
}: ReceiptSuccessModalProps) {
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(onClose, autoCloseMs);
    return () => window.clearTimeout(id);
  }, [open, onClose, autoCloseMs]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm canteen-modal-pop text-center">
        <DialogHeader className="sr-only">
          <DialogTitle>Payment Success</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          <div className="canteen-success-check">
            <svg
              viewBox="0 0 24 24"
              width="48"
              height="48"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 12l4.5 4.5L19 7" />
            </svg>
          </div>
          <div>
            <div className="text-lg font-bold">Payment Complete</div>
            <div className="text-xs text-muted-foreground">
              {receiptNumber}
            </div>
          </div>

          {studentName && (
            <div className="flex items-center gap-3 w-full rounded-xl border bg-muted/30 p-3">
              {studentPhotoUrl ? (
                <img
                  src={studentPhotoUrl}
                  alt={studentName}
                  className="h-12 w-12 shrink-0 rounded-full object-cover border bg-background"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <UserRound className="h-6 w-6" />
                </div>
              )}
              <div className="min-w-0 flex-1 text-left">
                <p className="text-sm font-semibold truncate">{studentName}</p>
                {studentGrade && (
                  <p className="text-xs text-muted-foreground">{studentGrade}</p>
                )}
              </div>
            </div>
          )}

          <div className="w-full rounded-2xl border border-amber-100 bg-amber-50/60 p-4 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Charged</span>
              <span className="tabular-nums font-bold text-amber-700">
                ฿{amount.toFixed(2)}
              </span>
            </div>
            {remainingBalance !== null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Remaining balance</span>
                <span
                  className={
                    remainingBalance < 0
                      ? "tabular-nums text-amber-700"
                      : "tabular-nums"
                  }
                >
                  ฿{remainingBalance.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={onClose}
          >
            Next order
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
