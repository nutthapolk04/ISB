import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Download, Receipt, ChevronRight } from "lucide-react";

interface StudentProfile {
  id: number;
  name: string;
  student_code?: string | null;
  wallet_id?: number | null;
}

interface Transaction {
  id: number;
  wallet_id: number;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  reference_type?: string | null;
  reference_id?: number | null;
  description?: string | null;
  shop_id?: string | null;
  shop_name?: string | null;
  created_at: string;
}

interface ReceiptItem {
  id: number;
  product_variant_id: number;
  quantity: number;
  unit_price: number;
  discount: number;
  line_total: number;
  product_variant?: {
    sku?: string | null;
    variant_name?: string | null;
  } | null;
}

interface ReceiptDetail {
  id: number;
  receipt_number: string;
  status: string;
  payment_method: string;
  total_amount: number;
  items: ReceiptItem[];
  created_at: string;
}

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

export default function TransactionHistory() {
  const { customerId } = useParams<{ customerId: string }>();
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [receiptModal, setReceiptModal] = useState<{ tx: Transaction } | null>(null);
  const [receiptDetail, setReceiptDetail] = useState<ReceiptDetail | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);

  const locale = i18n.language === "en" ? "en-US" : "th-TH";
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  const txTypeLabel = (type: string): string => {
    const map: Record<string, string> = {
      TOPUP: t("parent.transactions.txTopup"),
      DEDUCTION: t("parent.transactions.txDeduction"),
      REFUND: t("parent.transactions.txRefund"),
      ADJUSTMENT_CREDIT: t("parent.transactions.txAdjCredit"),
      ADJUSTMENT_DEBIT: t("parent.transactions.txAdjDebit"),
    };
    return map[type] ?? type;
  };

  const loadTransactions = async (walletId: number) => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    const qs = params.toString();
    const path = `/wallets/${walletId}/transactions${qs ? `?${qs}` : ""}`;
    try {
      const data = await api.get<Transaction[]>(path);
      setTxs(data);
    } catch (e) {
      toast({
        title: t("parent.transactions.historyFailed"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    (async () => {
      if (!customerId) return;
      try {
        const p = await api.get<StudentProfile>(`/customers/${customerId}`);
        setProfile(p);
        if (p.wallet_id) await loadTransactions(p.wallet_id);
      } catch (e) {
        toast({
          title: t("parent.transactions.loadFailed"),
          description: e instanceof ApiError ? e.detail : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [customerId]);

  const handleOpenReceipt = async (tx: Transaction) => {
    if (!tx.reference_id) return;
    setReceiptModal({ tx });
    setReceiptDetail(null);
    setReceiptLoading(true);
    try {
      const data = await api.get<ReceiptDetail>(`/pos/receipt/${tx.reference_id}`);
      setReceiptDetail(data);
    } catch {
      setReceiptDetail(null);
    } finally {
      setReceiptLoading(false);
    }
  };

  const handleFilter = () => {
    if (profile?.wallet_id) loadTransactions(profile.wallet_id);
  };

  const handleExportCSV = () => {
    // CSV headers stay in Thai since the file is for local accounting use
    const header = ["วันที่", "ประเภท", "ร้านค้า", "คำอธิบาย", "จำนวนเงิน", "คงเหลือ"];
    const rows = txs.map((tx) => [
      formatDate(tx.created_at),
      txTypeLabel(tx.transaction_type),
      (tx.shop_name ?? "").replace(/"/g, '""'),
      (tx.description ?? "").replace(/"/g, '""'),
      tx.amount.toFixed(2),
      tx.balance_after.toFixed(2),
    ]);
    const csv =
      "﻿" +
      [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wallet-${profile?.student_code ?? profile?.id}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="page-shell text-muted-foreground">{t("parent.common.loading")}</div>;
  if (!profile) return <div className="page-shell text-destructive">{t("parent.common.notFound")}</div>;

  return (
    <div className="page-shell">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="h-10">
          <Link to="/parent/dashboard"><ArrowLeft className="h-4 w-4 mr-1" /> {t("parent.common.back")}</Link>
        </Button>
      </div>

      <div className="page-header">
        <h1 className="page-title">
          {t("parent.transactions.title", { name: profile.name })}
        </h1>
        {profile.student_code && (
          <Badge variant="secondary" className="mt-1">{profile.student_code}</Badge>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("parent.transactions.filterTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div>
              <Label htmlFor="dateRange" className="text-xs">{t("parent.transactions.dateRange")}</Label>
              <DateRangePicker
                id="dateRange"
                startDate={dateFrom}
                endDate={dateTo}
                onStartChange={setDateFrom}
                onEndChange={setDateTo}
              />
            </div>
            <Button onClick={handleFilter} className="h-10">{t("parent.transactions.filter")}</Button>
            <Button variant="outline" onClick={handleExportCSV} disabled={txs.length === 0} className="h-10">
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("parent.transactions.listTitle", { count: txs.length })}</CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-6">
          {txs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {t("parent.transactions.noResults")}
            </p>
          ) : (
            <>
              {/* Mobile/tablet-portrait: card list */}
              <ul className="md:hidden space-y-2">
                {txs.map((tx) => {
                  const isCredit = (tx.balance_after ?? 0) >= (tx.balance_before ?? 0);
                  const hasReceipt = tx.reference_type === "receipt" && tx.reference_id;
                  return (
                    <li
                      key={tx.id}
                      className={`rounded-lg border bg-card p-3 space-y-2 ${hasReceipt ? "cursor-pointer hover:bg-muted/40 transition-colors" : ""}`}
                      onClick={() => hasReceipt && handleOpenReceipt(tx)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Badge variant={isCredit ? "default" : "secondary"} className="shrink-0">
                          {txTypeLabel(tx.transaction_type)}
                        </Badge>
                        <div className="flex items-center gap-1">
                          <div className={`text-right font-bold tabular-nums ${isCredit ? "text-green-600" : "text-destructive"}`}>
                            {isCredit ? "+" : "-"}{formatTHB(Math.abs(tx.amount))}
                          </div>
                          {hasReceipt && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                        </div>
                      </div>
                      {(tx.shop_name || tx.description) && (
                        <div className="text-sm space-y-0.5">
                          {tx.shop_name && (
                            <Badge variant="outline" className="font-normal">{tx.shop_name}</Badge>
                          )}
                          {tx.description && (
                            <p className="text-muted-foreground">{tx.description}</p>
                          )}
                        </div>
                      )}
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{formatDate(tx.created_at)}</span>
                        <span className="tabular-nums">
                          {t("parent.transactions.balanceAfter", { amount: formatTHB(tx.balance_after) })}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Desktop/tablet-landscape: table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("parent.transactions.colDate")}</TableHead>
                      <TableHead>{t("parent.transactions.colType")}</TableHead>
                      <TableHead>{t("parent.transactions.colShop")}</TableHead>
                      <TableHead>{t("parent.transactions.colDetail")}</TableHead>
                      <TableHead className="text-right">{t("parent.transactions.colAmount")}</TableHead>
                      <TableHead className="text-right">{t("parent.transactions.colBalance")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txs.map((tx) => {
                      const isCredit = (tx.balance_after ?? 0) >= (tx.balance_before ?? 0);
                      const hasReceipt = tx.reference_type === "receipt" && tx.reference_id;
                      return (
                        <TableRow
                          key={tx.id}
                          className={hasReceipt ? "cursor-pointer hover:bg-muted/40" : ""}
                          onClick={() => hasReceipt && handleOpenReceipt(tx)}
                        >
                          <TableCell className="text-sm">{formatDate(tx.created_at)}</TableCell>
                          <TableCell>
                            <Badge variant={isCredit ? "default" : "secondary"}>
                              {txTypeLabel(tx.transaction_type)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {tx.shop_name
                              ? <Badge variant="outline">{tx.shop_name}</Badge>
                              : <span className="text-muted-foreground">-</span>}
                          </TableCell>
                          <TableCell className="text-sm">
                            <span className="flex items-center gap-1">
                              {tx.description || "-"}
                              {hasReceipt && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                            </span>
                          </TableCell>
                          <TableCell className={`text-right font-semibold ${isCredit ? "text-green-600" : "text-destructive"}`}>
                            {isCredit ? "+" : "-"}{formatTHB(Math.abs(tx.amount))}
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatTHB(tx.balance_after)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      {/* Receipt detail modal */}
      <Dialog open={!!receiptModal} onOpenChange={(o) => { if (!o) setReceiptModal(null); }}>
        <DialogContent className="max-w-sm sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              {receiptDetail
                ? receiptDetail.receipt_number
                : receiptModal?.tx.description ?? t("parent.transactions.receiptTitle")}
            </DialogTitle>
          </DialogHeader>

          {receiptLoading && (
            <div className="space-y-2 py-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          )}

          {!receiptLoading && receiptDetail && (
            <div className="space-y-3">
              {/* Items table */}
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-xs py-2">{t("parent.transactions.itemName")}</TableHead>
                      <TableHead className="text-xs py-2 text-center w-12">{t("parent.transactions.itemQty")}</TableHead>
                      <TableHead className="text-xs py-2 text-right">{t("parent.transactions.itemPrice")}</TableHead>
                      <TableHead className="text-xs py-2 text-right">{t("parent.transactions.itemTotal")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receiptDetail.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-sm py-2">
                          {item.product_variant?.variant_name ?? `#${item.product_variant_id}`}
                          {item.product_variant?.sku && (
                            <span className="block text-xs text-muted-foreground font-mono">
                              {item.product_variant.sku}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm py-2 text-center">{item.quantity}</TableCell>
                        <TableCell className="text-sm py-2 text-right tabular-nums">
                          {formatTHB(item.unit_price)}
                          {item.discount > 0 && (
                            <span className="block text-xs text-green-600">
                              -{formatTHB(item.discount)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm py-2 text-right font-medium tabular-nums">
                          {formatTHB(item.line_total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Summary */}
              <div className="rounded-md bg-muted/50 p-3 space-y-1.5 text-sm">
                <div className="flex justify-between font-bold text-base">
                  <span>{t("parent.transactions.totalAmount")}</span>
                  <span className="tabular-nums text-destructive">
                    -{formatTHB(
                      Number(receiptDetail.total_amount) ||
                      receiptDetail.items.reduce((s, i) => s + Number(i.line_total), 0)
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t("parent.transactions.paymentMethod")}</span>
                  <span className="capitalize">{receiptDetail.payment_method.replace(/_/g, " ")}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t("parent.transactions.receiptDate")}</span>
                  <span>{formatDate(receiptDetail.created_at)}</span>
                </div>
                {receiptDetail.status !== "active" && (
                  <Badge variant="destructive" className="mt-1 text-xs">
                    {receiptDetail.status.toUpperCase()}
                  </Badge>
                )}
              </div>
            </div>
          )}

          {!receiptLoading && !receiptDetail && (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t("parent.transactions.receiptNotFound")}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
