/**
 * ReceiptDetailDialog — reusable receipt viewer.
 *
 * Pass `receiptId` (number) to open; set to `null` to close.
 * Fetches full detail from /pos/receipt/{id} automatically.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Receipt, Download, Loader2, Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { printReceipt } from "@/lib/printReceipt";
import type { ReceiptApi } from "@/lib/printReceipt";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReceiptOptionsSnapshotApi {
  options_total: number;
  groups: Array<{
    group_id: number;
    name: string;
    selection_type: "single" | "multi" | "quantity";
    options: Array<{
      option_id: number;
      name: string;
      price_delta: number;
      quantity: number;
    }>;
  }>;
}

interface ReceiptItemApi {
  id: number;
  receipt_id: number;
  product_variant_id: number;
  quantity: number;
  unit_price: number;
  discount: number;
  line_total: number;
  options?: ReceiptOptionsSnapshotApi | null;
  created_at: string;
  product_variant?: {
    sku: string | null;
    variant_name: string | null;
    barcode: string | null;
  } | null;
}

interface PayerDetail {
  name: string;
  code: string | null;
  grade: string | null;
  photo_url: string | null;
  role: string;
  wallet_balance: number | null;
}

export interface ReceiptDetailData {
  id: number;
  receipt_number: string;
  transaction_date: string;
  transaction_mode: string;
  customer_id: number | null;
  payer_user_id?: number | null;
  payer_department_id?: number | null;
  payer_kind?: string | null;
  payer_label?: string | null;
  payer_detail?: PayerDetail | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payment_method: string;
  status: string;
  shop_id?: string | null;
  shop_name?: string | null;
  notes: string | null;
  cash_received?: number | null;
  created_at: string;
  created_by: number;
  created_by_name?: string | null;
  voided_at: string | null;
  voided_by: number | null;
  voided_reason: string | null;
  items: ReceiptItemApi[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("th-TH", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ReceiptDetailDialogProps {
  receiptId: number | null;
  onClose: () => void;
}

export function ReceiptDetailDialog({ receiptId, onClose }: ReceiptDetailDialogProps) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const schoolInfo = useSchoolInfo();
  const [receipt, setReceipt] = useState<ReceiptDetailData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (receiptId === null) {
      setReceipt(null);
      return;
    }
    setLoading(true);
    api
      .get<ReceiptDetailData>(`/pos/receipt/${receiptId}`)
      .then(setReceipt)
      .finally(() => setLoading(false));
  }, [receiptId]);

  return (
    <Dialog open={receiptId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {t("receipts.details", "Receipt Details")}
          </DialogTitle>
          {receipt && (
            <DialogDescription>
              {t("receipts.receiptId", "No.")}: {receipt.receipt_number}
            </DialogDescription>
          )}
        </DialogHeader>

        {loading && (
          <div className="space-y-3 py-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        )}

        {!loading && receipt && (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {/* Meta */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">{t("receipts.dateTime", "Date/Time")}:</span>
                <span className="text-sm font-medium">{fmtDate(receipt.transaction_date)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">{t("receipts.paymentMethod", "Payment")}:</span>
                <span className="text-sm font-semibold">
                  {t(`common.paymentMethods.${receipt.payment_method}`, receipt.payment_method)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">{t("receipts.status", "Status")}:</span>
                <Badge variant={receipt.status === "active" ? "success" : "destructive"}>
                  {receipt.status === "active" ? "Active" : "Voided"}
                </Badge>
              </div>
              {receipt.notes && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">{t("receipts.notes", "Notes")}:</span>
                  <span className="text-sm">{receipt.notes}</span>
                </div>
              )}
              {receipt.voided_reason && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">{t("receipts.voidReason", "Void reason")}:</span>
                  <span className="text-sm text-destructive">{receipt.voided_reason}</span>
                </div>
              )}
            </div>

            <Separator />

            {/* Seller (shop) */}
            {receipt.shop_name && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">{t("receipts.shop", "Shop")}:</span>
                <span className="text-sm font-semibold">{receipt.shop_name}</span>
              </div>
            )}

            {/* Cashier */}
            {receipt.created_by_name && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">{t("receipts.cashier", "Cashier")}:</span>
                <span className="text-sm">{receipt.created_by_name}</span>
              </div>
            )}

            {(receipt.shop_name || receipt.created_by_name) && <Separator />}

            {/* Payer card */}
            {receipt.payer_detail && (
              <>
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 flex items-center gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-blue-100 flex items-center justify-center">
                    {receipt.payer_detail.photo_url ? (
                      <img
                        src={receipt.payer_detail.photo_url}
                        alt={receipt.payer_detail.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-xl text-blue-400 font-bold">
                        {receipt.payer_detail.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{receipt.payer_detail.name}</div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {receipt.payer_detail.code && (
                        <div>
                          {t("receipts.code", "Code")}: <span className="font-mono">{receipt.payer_detail.code}</span>
                        </div>
                      )}
                      {receipt.payer_detail.grade && (
                        <div>
                          {receipt.payer_detail.role === "student"
                            ? `${t("receipts.gradeLabel", "Grade")}: `
                            : `${t("receipts.departmentLabel", "Department")}: `}
                          {receipt.payer_detail.grade}
                        </div>
                      )}
                      <div className="capitalize text-blue-600 font-medium">
                        {receipt.payer_detail.role}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-muted-foreground">{t("receipts.balance", "Balance")}</div>
                    <div
                      className={cn(
                        "text-base font-bold tabular-nums",
                        (receipt.payer_detail.wallet_balance ?? 0) < 0
                          ? "text-destructive"
                          : "text-emerald-600",
                      )}
                    >
                      {receipt.payer_detail.wallet_balance !== null
                        ? `฿${receipt.payer_detail.wallet_balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                        : "—"}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{t("receipts.afterPayment", "After payment")}</div>
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* Items */}
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">{t("receipts.productList", "Items")}</h4>
              {receipt.items.map((item) => {
                const hasDiscount = item.discount > 0;
                const opts = item.options as { is_bundle?: boolean; bundle_name?: string; groups?: any[] } | null | undefined;
                const isBundle = opts?.is_bundle === true;
                const displayName = isBundle
                  ? (opts?.bundle_name ?? "Bundle")
                  : item.product_variant?.variant_name ?? `Product #${item.product_variant_id}`;
                return (
                  <div key={item.id} className="text-sm">
                    <div className="flex justify-between">
                      <span>
                        {displayName} ×{" "}
                        {item.quantity}
                      </span>
                      <span className="tabular-nums">฿{item.line_total.toLocaleString()}</span>
                    </div>
                    {!isBundle && opts?.groups && opts.groups.length > 0 && (
                      <div className="pl-4 pt-0.5 space-y-0.5 text-xs text-muted-foreground">
                        {opts.groups.flatMap((g: any) =>
                          g.options.map((o: any) => (
                            <div key={`${g.group_id}-${o.option_id}`} className="flex justify-between">
                              <span>
                                + {o.name}
                                {o.quantity > 1 && ` ×${o.quantity}`}
                              </span>
                              {o.price_delta > 0 && (
                                <span className="tabular-nums">
                                  +฿{(o.price_delta * o.quantity).toLocaleString()}
                                </span>
                              )}
                            </div>
                          )),
                        )}
                      </div>
                    )}
                    {hasDiscount && (
                      <div className="flex justify-between text-destructive text-xs pl-4">
                        <span>{t("receipts.itemDiscount", "Discount")}</span>
                        <span className="tabular-nums">-฿{item.discount.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <Separator />

            {/* Totals */}
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("receipts.subtotal", "Subtotal")}</span>
                <span className="tabular-nums">฿{receipt.subtotal.toLocaleString()}</span>
              </div>
              {receipt.discount > 0 && (
                <div className="flex justify-between text-destructive">
                  <span>{t("receipts.billDiscount", "Bill Discount")}</span>
                  <span className="tabular-nums">-฿{receipt.discount.toLocaleString()}</span>
                </div>
              )}
              {receipt.tax > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("receipts.tax", "Tax")}</span>
                  <span className="tabular-nums">฿{receipt.tax.toLocaleString()}</span>
                </div>
              )}
            </div>

            <Separator />

            <div className="flex justify-between text-lg font-bold">
              <span>{t("receipts.grandTotal", "Grand Total")}</span>
              <span className="text-primary tabular-nums">฿{receipt.total.toLocaleString()}</span>
            </div>

            {receipt.payment_method.toLowerCase() === "cash" && receipt.cash_received != null && (
              <div className="rounded-xl border bg-muted/40 p-3 text-sm space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("receipts.cashReceived", "Cash received")}
                  </span>
                  <span className="tabular-nums">
                    ฿{receipt.cash_received.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between font-semibold border-t pt-1.5">
                  <span>{t("receipts.change", "Change")}</span>
                  <span className="text-emerald-600 tabular-nums">
                    ฿{Math.max(0, receipt.cash_received - receipt.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="default"
                className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                onClick={() => printReceipt(receipt as unknown as ReceiptApi, schoolInfo, user?.shopName, "en")}
              >
                <Printer className="h-4 w-4 mr-2" />
                {t("receipts.print", "Print")}
              </Button>
              <Button
                variant="outline"
                onClick={() => printReceipt(receipt as unknown as ReceiptApi, schoolInfo, user?.shopName, "en")}
              >
                <Download className="h-4 w-4 mr-2" />
                {t("receipts.download", "Save PDF")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
