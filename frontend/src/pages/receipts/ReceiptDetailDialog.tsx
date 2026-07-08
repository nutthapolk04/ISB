import React from "react";
import { useTranslation } from "react-i18next";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Receipt, Download, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDateTime as fmtDateTimeShared } from "@/lib/dateFormat";
import { printReceipt as printReceiptShared, downloadReceiptHtml, type ReceiptApi as LibReceiptApi } from "@/lib/printReceipt";
import { resolveAvatarUrl, getFallbackAvatar } from "@/lib/avatarFallback";
import type { ReceiptApi } from "./receiptTypes";

interface ReceiptDetailDialogProps {
  receipt: ReceiptApi | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReceiptDetailDialog({ receipt, open, onOpenChange }: ReceiptDetailDialogProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const schoolInfo = useSchoolInfo();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <Receipt className="h-5 w-5 mr-2" />
            {t("receipts.details")}
          </DialogTitle>
          <DialogDescription>
            {t("receipts.receiptId")}: {receipt?.receipt_number}
          </DialogDescription>
        </DialogHeader>
        {receipt && (() => {
          const isWallet = receipt.payment_method.toLowerCase() === "wallet";
          const walletBalanceAfter = receipt.payer_detail?.wallet_balance ?? null;
          const balanceBefore = isWallet && walletBalanceAfter !== null ? walletBalanceAfter + receipt.total : null;
          const row = (label: string, value: React.ReactNode, bold = false) => (
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className={bold ? "font-semibold" : ""}>{value}</span>
            </div>
          );
          return (
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              {receipt.status !== "active" && (
                <div className="rounded border-2 border-destructive bg-destructive/10 p-2 text-center text-xs font-bold text-destructive">
                  *** THIS RECEIPT HAS BEEN VOIDED ***
                </div>
              )}

              {/* Block 1: Receipt No / Date / Cashier */}
              <div className="space-y-1.5">
                {row(t("receipts.receiptNo", "Receipt No"), <span className="font-mono font-semibold">{receipt.receipt_number}</span>)}
                {row(t("receipts.dateTime"), fmtDateTimeShared(receipt.transaction_date))}
                {receipt.created_by_name && row(t("receipts.cashier", "Cashier"), receipt.created_by_name, true)}
                {receipt.shop_name && row(t("receipts.shop", "Shop"), receipt.shop_name)}
              </div>

              <Separator />

              {/* Block 2: Payer / Payment Type / Status */}
              <div className="space-y-1.5">
                {receipt.payer_detail && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 flex items-center gap-3">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-blue-100 flex items-center justify-center">
                      <img src={resolveAvatarUrl(receipt.payer_detail.photo_url, receipt.payer_detail.name)} alt={receipt.payer_detail.name} className="h-full w-full object-cover" onError={(e) => { e.currentTarget.src = getFallbackAvatar(receipt.payer_detail?.name); }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm truncate">{receipt.payer_detail.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {receipt.payer_detail.code && <span className="font-mono">{receipt.payer_detail.code}</span>}
                        {receipt.payer_detail.grade && (
                          <span className="ml-1">
                            {receipt.payer_detail.role === "student"
                              ? `· ${t("receipts.searchPanel.detailGrade")} ${receipt.payer_detail.grade}`
                              : `· ${receipt.payer_detail.grade}`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {!receipt.payer_detail && receipt.payer_label && row(t("receipts.payer", "Payer"), receipt.payer_label, true)}
                {row(t("receipts.paymentMethod"), t(`common.paymentMethods.${(receipt.payment_method ?? "").toLowerCase()}`, receipt.payment_method), true)}
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">{t("receipts.status", "Status")}</span>
                  <Badge variant={receipt.status === "active" ? "success" : "destructive"}>
                    {receipt.status === "active" ? "Active" : "Voided"}
                  </Badge>
                </div>
              </div>

              <Separator />

              {/* Block 3: Items */}
              <div className="space-y-2">
                {receipt.items.map((item) => {
                  const gross = item.line_total;
                  const hasItemDiscount = item.discount > 0;
                  const opts = item.options as { is_bundle?: boolean; bundle_name?: string; groups?: any[] } | null | undefined;
                  const isBundle = opts?.is_bundle === true;
                  const displayName = isBundle
                    ? (opts?.bundle_name ?? "Bundle")
                    : item.product_variant?.variant_name ?? `Product #${item.product_variant_id}`;
                  return (
                    <div key={item.id} className="text-sm">
                      <div className="flex justify-between">
                        <span>{displayName} ×{item.quantity}</span>
                        <span className="data-number">฿{gross.toLocaleString()}</span>
                      </div>
                      <div className="pl-4 pt-0.5 text-xs text-muted-foreground">
                        Unit price: ฿{item.unit_price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        {" · "}
                        Total: ฿{gross.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                      {!isBundle && opts?.groups && opts.groups.length > 0 && (
                        <div className="pl-4 pt-0.5 space-y-0.5 text-xs text-muted-foreground">
                          {opts.groups.flatMap((g: any) =>
                            g.options.map((o: any) => (
                              <div key={`${g.group_id}-${o.option_id}`} className="flex justify-between">
                                <span>+ {o.name}{o.quantity > 1 && ` ×${o.quantity}`}</span>
                                {o.price_delta > 0 && <span className="data-number">+฿{(o.price_delta * o.quantity).toLocaleString()}</span>}
                              </div>
                            )),
                          )}
                        </div>
                      )}
                      {hasItemDiscount && (
                        <div className="flex justify-between text-destructive text-xs pl-4">
                          <span>{t("receipts.itemDiscount", "ส่วนลด")}</span>
                          <span className="data-number">-฿{item.discount.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <Separator />

              {/* Block 4: Balance Before / Subtotal / Grand Total / Balance After */}
              <div className="space-y-1.5">
                {balanceBefore !== null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("receipts.balanceBefore", "Balance Before This Sale")}</span>
                    <span className="data-number">฿{balanceBefore.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {row(t("receipts.subtotal", "Subtotal"), `฿${receipt.subtotal.toLocaleString()}`)}
                {receipt.discount > 0 && (
                  <div className="flex justify-between text-sm text-destructive">
                    <span>{t("receipts.billDiscount", "Bill Discount")}</span>
                    <span className="data-number">-฿{receipt.discount.toLocaleString()}</span>
                  </div>
                )}
                {receipt.tax > 0 && row(t("receipts.tax", "Tax"), `฿${receipt.tax.toLocaleString()}`)}
                <div className="flex justify-between text-base font-bold">
                  <span>{t("receipts.grandTotal")}</span>
                  <span className="text-primary data-number">฿{receipt.total.toLocaleString()}</span>
                </div>
                {walletBalanceAfter !== null && (
                  <div className="flex justify-between text-sm font-semibold">
                    <span className="text-muted-foreground">{t("receipts.balanceAfter", "Balance After This Sale")}</span>
                    <span className={cn("data-number", walletBalanceAfter < 0 ? "text-destructive" : "text-emerald-600")}>
                      ฿{walletBalanceAfter.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {receipt.payment_method.toLowerCase() === "cash" && receipt.cash_received != null && (
                  <div className="rounded-xl border bg-muted/40 p-3 text-sm space-y-1.5 mt-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("receipts.cashReceived", "Cash received")}</span>
                      <span className="data-number">฿{receipt.cash_received.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between font-semibold border-t pt-1.5">
                      <span>{t("receipts.change", "Change")}</span>
                      <span className="text-emerald-600 data-number">
                        ฿{Math.max(0, receipt.cash_received - receipt.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                )}
                {receipt.notes && (
                  <div className="pt-1 text-xs text-muted-foreground">
                    <span className="font-semibold">{t("receipts.notes", "Note")}: </span>{receipt.notes}
                  </div>
                )}
                {receipt.voided_reason && (
                  <div className="text-xs text-destructive">
                    <span className="font-semibold">{t("receipts.voidReason", "Void reason")}: </span>{receipt.voided_reason}
                  </div>
                )}
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-2">
                <Button
                  className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                  onClick={() => printReceiptShared(receipt as unknown as LibReceiptApi, schoolInfo, receipt.shop_name ?? user?.shopName, "en")}
                >
                  <Printer className="h-4 w-4 mr-2" />
                  {t("receipts.print", "Print")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => downloadReceiptHtml(receipt as unknown as LibReceiptApi, schoolInfo, receipt.shop_name ?? user?.shopName, "en")}
                >
                  <Download className="h-4 w-4 mr-2" />
                  {t("receipts.download", "Save PDF")}
                </Button>
              </div>
            </div>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}
