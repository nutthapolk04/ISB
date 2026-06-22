/**
 * TopupDetailDialog — shows top-up / credit transaction details inline.
 *
 * Takes the full Transaction record (no API call needed — all data is in the tx).
 * Open by passing a Transaction object; close by passing null.
 */
import { useTranslation } from "react-i18next";
import { ArrowUpCircle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { fmtDateTime } from "@/lib/dateFormat";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TopupTransaction {
  id: number;
  wallet_id: number;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  description?: string | null;
  reference_type?: string | null;
  reference_id?: number | null;
  shop_name?: string | null;
  confirmed_via?: string | null;
  created_at: string;
}

interface TopupDetailDialogProps {
  transaction: TopupTransaction | null;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

/**
 * Parse a reference code from descriptions like:
 *   "Top-up via PromptPay (TOP-20260608-008)"
 *   "Wallet top-up (REF-123)"
 * Returns the code inside the last pair of parens, or null.
 */
function parseRefCode(description: string | null | undefined): string | null {
  if (!description) return null;
  const match = description.match(/\(([^)]+)\)\s*$/);
  return match ? match[1] : null;
}

/**
 * Parse the payment method from a description string.
 * Looks for "via <Method>" pattern first; falls back to known keywords.
 */
function parsePaymentMethod(
  description: string | null | undefined,
  transactionType: string,
): string {
  if (!description) return transactionType;

  const lower = description.toLowerCase();

  // QR variants — show "QR Code" for any QR-style method
  if (lower.includes("promptpay") || lower.includes("qr")) return "QR Code";

  // EDC
  if (lower.includes("edc")) return "EDC";

  // "via ..." pattern (after QR/EDC overrides above)
  const viaMatch = description.match(/\bvia\s+([^(]+?)(?:\s*\(|$)/i);
  if (viaMatch) return viaMatch[1].trim();

  // Family transfer
  if (lower.includes("family transfer") || lower.includes("transfer")) return "Family transfer";

  // Cash must be checked before "credit" to avoid "Admin credit adjustment" false-positive
  if (lower.includes("cash")) return "Cash";
  if (lower.includes("credit") || lower.includes("card")) return "Credit/Debit Card";
  if (lower.includes("cashier")) return "Cashier";

  return transactionType;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TopupDetailDialog({ transaction, onClose }: TopupDetailDialogProps) {
  const { t } = useTranslation();

  if (!transaction) {
    return (
      <Dialog open={false} onOpenChange={() => {}}>
        <DialogContent />
      </Dialog>
    );
  }

  const isCredit = transaction.balance_after >= transaction.balance_before;
  const refCode = parseRefCode(transaction.description);
  const paymentMethod = parsePaymentMethod(transaction.description, transaction.transaction_type);

  // Determine dialog title based on transaction_type
  const isTopup =
    transaction.transaction_type.toUpperCase() === "TOPUP" ||
    transaction.transaction_type.toUpperCase() === "TOP_UP" ||
    isCredit;

  const title = isTopup
    ? t("topup.detail.title", "Top-up Details")
    : t("topup.detail.titleGeneric", "Transaction Details");

  const subtitle = isTopup
    ? t("topup.detail.subtitle", "Top-up transaction details")
    : t("topup.detail.subtitleGeneric", "Transaction details");

  // Channel: where / how the top-up was initiated
  function resolveChannel(): string | null {
    const via = transaction.confirmed_via ?? "";
    const shop = transaction.shop_name;
    const method = paymentMethod.toLowerCase();

    // Cashier or kiosk top-up — shop name known
    if (shop) return shop;

    // Online flows — derive from confirmed_via or method
    if (via.includes("webhook") || via.includes("inquiry")) {
      if (method.includes("qr") || method.includes("promptpay")) return t("topup.detail.channelParentApp", "Parent App (QR)");
      if (method.includes("credit") || method.includes("card")) return t("topup.detail.channelOnlineCard", "Online (Credit Card)");
      return t("topup.detail.channelOnline", "Online");
    }
    if (via === "cashier_manual" || via.includes("cashier")) return t("topup.detail.channelCashier", "Cashier");
    if (method.includes("cash")) return t("topup.detail.channelCashier", "Cashier");
    if (method.includes("qr") || method.includes("promptpay")) return t("topup.detail.channelParentApp", "Parent App (QR)");
    if (method.includes("credit") || method.includes("card")) return t("topup.detail.channelOnlineCard", "Online (Credit Card)");
    return null;
  }
  const channel = resolveChannel();

  return (
    <Dialog open={transaction !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5 text-emerald-600" />
            {title}
          </DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Amount — hero */}
          <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 text-center">
            <p className="text-xs text-emerald-600 font-medium mb-1">
              {t("topup.detail.amount", "Amount")}
            </p>
            <p className={`text-3xl font-extrabold tabular-nums ${isCredit ? "text-emerald-600" : "text-red-500"}`}>
              {isCredit ? "+" : "-"}{formatTHB(Math.abs(transaction.amount))}
            </p>
          </div>

          {/* Details rows */}
          <div className="space-y-2 text-sm">
            {/* Date/time */}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">{t("topup.detail.dateTime", "Date / Time")}</span>
              <span className="font-medium">{fmtDateTime(transaction.created_at)}</span>
            </div>

            {/* Payment method */}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">{t("topup.detail.method", "Method")}</span>
              <span className="font-semibold">{paymentMethod}</span>
            </div>

            {/* Channel — where/how the top-up was done */}
            {channel && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">{t("topup.detail.channel", "Channel")}</span>
                <span className="font-medium">{channel}</span>
              </div>
            )}

            {/* Reference code */}
            {refCode && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">{t("topup.detail.refCode", "Reference")}</span>
                <span className="font-mono text-xs bg-slate-100 rounded px-2 py-0.5">{refCode}</span>
              </div>
            )}

            {/* Notes — show only when description adds unique info beyond method/ref */}
            {transaction.description && !refCode && (
              <div className="flex justify-between items-start gap-4">
                <span className="text-muted-foreground shrink-0">{t("topup.detail.notes", "Notes")}</span>
                <span className="text-right text-xs text-slate-600 break-words max-w-[60%]">
                  {transaction.description}
                </span>
              </div>
            )}
          </div>

          <Separator />

          {/* Balance before / after */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">{t("topup.detail.balanceBefore", "Balance before")}</span>
              <span className="tabular-nums font-medium">{formatTHB(transaction.balance_before)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">{t("topup.detail.balanceAfter", "Balance after")}</span>
              <span className="tabular-nums font-semibold text-emerald-700">{formatTHB(transaction.balance_after)}</span>
            </div>
          </div>

          <Separator />

          {/* Status */}
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">{t("topup.detail.status", "Status")}</span>
            <Badge className="gap-1 bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-100">
              <CheckCircle2 className="h-3 w-3" />
              {t("topup.detail.statusComplete", "Complete")}
            </Badge>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
