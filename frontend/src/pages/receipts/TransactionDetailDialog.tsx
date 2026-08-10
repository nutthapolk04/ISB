import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Activity, Loader2, Receipt, RefreshCw } from "lucide-react";
import { fmtDateTime as fmtDateTimeShared } from "@/lib/dateFormat";
import { formatPaymentMethodLabel } from "@/lib/paymentMethodLabels";
import type { TransactionDetailApi, TransactionStatus } from "./transactionTypes";

interface TransactionDetailDialogProps {
  transaction: TransactionDetailApi | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the real ReceiptDetailDialog for a completed sale's receipt. */
  onViewReceipt: (receiptId: number) => void;
  /**
   * Asks the bank directly (only meaningful for a still-pending QR sale — a
   * webhook that never arrived is otherwise invisible until someone forces a
   * check). Absent for anything that can't be re-checked.
   */
  onCheckNow?: () => void;
  checking?: boolean;
}

const STATUS_BADGE: Record<TransactionStatus, "warning" | "success" | "destructive" | "secondary"> = {
  pending: "warning",
  success: "success",
  failed: "destructive",
  cancelled: "secondary",
};

export function TransactionDetailDialog({ transaction, open, onOpenChange, onViewReceipt, onCheckNow, checking }: TransactionDetailDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <Activity className="h-5 w-5 mr-2" />
            {t("receipts.transactions.details", "Transaction Details")}
          </DialogTitle>
          <DialogDescription>
            {t("receipts.transactions.bankRef", "Bank Ref. No.")}: {transaction?.ref_code ?? "—"}
          </DialogDescription>
        </DialogHeader>
        {transaction && (() => {
          const statusKey = `status${transaction.status.charAt(0).toUpperCase()}${transaction.status.slice(1)}`;
          const row = (label: string, value: ReactNode, bold = false) => (
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className={bold ? "font-semibold" : ""}>{value}</span>
            </div>
          );
          return (
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">{t("receipts.transactions.status", "Status")}</span>
                <Badge variant={STATUS_BADGE[transaction.status]}>
                  {t(`receipts.transactions.${statusKey}`, transaction.status)}
                </Badge>
              </div>
              {transaction.status === "pending" && transaction.payment_method === "bay_qr" && transaction.ref_code && onCheckNow && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={onCheckNow}
                  disabled={checking}
                >
                  {checking ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  {t("receipts.transactions.checkNow", "Check with Bank Now")}
                </Button>
              )}

              {row(t("receipts.transactions.startedAt", "Start Time"), fmtDateTimeShared(transaction.created_at))}
              {row(
                t("receipts.transactions.endedAt", "End Time"),
                transaction.resolved_at
                  ? fmtDateTimeShared(transaction.resolved_at)
                  : <span className="text-amber-600 italic">{t("receipts.transactions.stillWaiting", "Still waiting…")}</span>,
              )}

              <Separator />

              {row(t("receipts.paymentMethod"), formatPaymentMethodLabel(t, transaction.payment_method), true)}
              {transaction.shop_name && row(t("receipts.shop", "Shop"), transaction.shop_name)}
              {transaction.cashier_name && row(t("receipts.cashier", "Cashier"), transaction.cashier_name, true)}
              {transaction.ref_code && row(t("receipts.transactions.bankRef", "Bank Ref. No."), <span className="font-mono text-xs">{transaction.ref_code}</span>)}
              {transaction.amount != null && row(t("receipts.total"), `฿${transaction.amount.toLocaleString()}`, true)}

              <Separator />

              {transaction.items === undefined ? (
                <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("receipts.transactions.itemsLoading", "Loading cart…")}
                </div>
              ) : transaction.items.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-1">
                  {t("receipts.transactions.itemsNone", "No cart snapshot for this attempt")}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {transaction.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span>{item.name} ×{item.quantity}</span>
                      {item.unit_price != null && (
                        <span className="data-number">฿{(item.unit_price * item.quantity).toLocaleString()}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {transaction.status === "failed" && transaction.error_message && (
                <>
                  <Separator />
                  <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                    {transaction.error_message}
                  </div>
                </>
              )}

              {transaction.status === "success" && transaction.receipt_id && (
                <>
                  <Separator />
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => onViewReceipt(transaction.receipt_id!)}
                  >
                    <Receipt className="h-4 w-4 mr-2" />
                    {t("receipts.tooltip.view", "View")}
                    {transaction.receipt_number ? ` · ${transaction.receipt_number}` : ""}
                  </Button>
                </>
              )}
            </div>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}
