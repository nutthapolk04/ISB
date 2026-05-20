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
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Download, ChevronRight } from "lucide-react";
import { ReceiptDetailDialog } from "@/components/ReceiptDetailDialog";

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
  const [openReceiptId, setOpenReceiptId] = useState<number | null>(null);

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

  const handleOpenReceipt = (tx: Transaction) => {
    if (tx.reference_id) setOpenReceiptId(tx.reference_id);
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
    <div className="page-shell space-y-4">
      {/* Back button */}
      <div className="flex items-center gap-2">
        <Button asChild size="sm" className="h-9 bg-orange-500 hover:bg-orange-600 text-white shadow-sm">
          <Link to="/parent/dashboard"><ArrowLeft className="h-4 w-4 mr-1" /> {t("parent.common.back")}</Link>
        </Button>
      </div>

      {/* Header banner */}
      <div className="rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-400 px-6 py-5 shadow-lg text-white">
        <h1 className="text-2xl font-bold tracking-tight drop-shadow-sm">
          {t("parent.transactions.title", { name: profile.name })}
        </h1>
        {profile.student_code && (
          <span className="mt-2 inline-block rounded-full bg-white/25 px-3 py-0.5 text-sm font-medium text-white">
            {profile.student_code}
          </span>
        )}
      </div>

      {/* Filter card */}
      <Card className="rounded-2xl shadow-md border-orange-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-orange-600">{t("parent.transactions.filterTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div>
              <Label htmlFor="dateRange" className="text-xs text-orange-500 font-medium">{t("parent.transactions.dateRange")}</Label>
              <DateRangePicker
                id="dateRange"
                startDate={dateFrom}
                endDate={dateTo}
                onStartChange={setDateFrom}
                onEndChange={setDateTo}
              />
            </div>
            <Button onClick={handleFilter} className="h-10 bg-orange-500 hover:bg-orange-600 text-white shadow-sm">
              {t("parent.transactions.filter")}
            </Button>
            <Button variant="outline" onClick={handleExportCSV} disabled={txs.length === 0} className="h-10 border-orange-300 text-orange-600 hover:bg-orange-50">
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Transaction list card */}
      <Card className="rounded-2xl shadow-md border-orange-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-orange-600">
            {t("parent.transactions.listTitle", { count: txs.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-6">
          {txs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="rounded-full bg-gradient-to-br from-orange-100 to-amber-100 p-5">
                <Download className="h-8 w-8 text-orange-400" />
              </div>
              <p className="text-center text-orange-400 font-medium">
                {t("parent.transactions.noResults")}
              </p>
            </div>
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
                      className={`rounded-xl border bg-white shadow-sm overflow-hidden ${hasReceipt ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}
                      onClick={() => hasReceipt && handleOpenReceipt(tx)}
                    >
                      {/* accent bar */}
                      <div className={`h-1 w-full ${isCredit ? "bg-gradient-to-r from-green-400 to-emerald-500" : "bg-gradient-to-r from-red-400 to-orange-400"}`} />
                      <div className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <Badge
                            variant={isCredit ? "default" : "secondary"}
                            className={`shrink-0 text-xs ${isCredit ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-100" : "bg-red-100 text-red-600 border-red-200 hover:bg-red-100"}`}
                          >
                            {txTypeLabel(tx.transaction_type)}
                          </Badge>
                          <div className="flex items-center gap-1">
                            <div className={`text-right font-bold tabular-nums text-base ${isCredit ? "text-green-600" : "text-red-500"}`}>
                              {isCredit ? "+" : "-"}{formatTHB(Math.abs(tx.amount))}
                            </div>
                            {hasReceipt && <ChevronRight className="h-4 w-4 text-orange-400 shrink-0" />}
                          </div>
                        </div>
                        {(tx.shop_name || tx.description) && (
                          <div className="text-sm space-y-0.5">
                            {tx.shop_name && (
                              <Badge variant="outline" className="font-normal border-amber-200 text-amber-700 bg-amber-50">{tx.shop_name}</Badge>
                            )}
                            {tx.description && (
                              <p className="text-gray-500">{tx.description}</p>
                            )}
                          </div>
                        )}
                        <div className="flex justify-between text-xs text-gray-400">
                          <span>{formatDate(tx.created_at)}</span>
                          <span className="tabular-nums font-medium text-gray-500">
                            {t("parent.transactions.balanceAfter", { amount: formatTHB(tx.balance_after) })}
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Desktop/tablet-landscape: table */}
              <div className="hidden md:block rounded-xl overflow-hidden border border-orange-100">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gradient-to-r from-orange-50 to-amber-50 hover:from-orange-50 hover:to-amber-50">
                      <TableHead className="font-semibold text-orange-700">{t("parent.transactions.colDate")}</TableHead>
                      <TableHead className="font-semibold text-orange-700">{t("parent.transactions.colType")}</TableHead>
                      <TableHead className="font-semibold text-orange-700">{t("parent.transactions.colShop")}</TableHead>
                      <TableHead className="font-semibold text-orange-700">{t("parent.transactions.colDetail")}</TableHead>
                      <TableHead className="text-right font-semibold text-orange-700">{t("parent.transactions.colAmount")}</TableHead>
                      <TableHead className="text-right font-semibold text-orange-700">{t("parent.transactions.colBalance")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txs.map((tx) => {
                      const isCredit = (tx.balance_after ?? 0) >= (tx.balance_before ?? 0);
                      const hasReceipt = tx.reference_type === "receipt" && tx.reference_id;
                      return (
                        <TableRow
                          key={tx.id}
                          className={`border-b border-orange-50 ${hasReceipt ? "cursor-pointer hover:bg-orange-50/60" : "hover:bg-amber-50/40"} transition-colors`}
                          onClick={() => hasReceipt && handleOpenReceipt(tx)}
                        >
                          <TableCell className="text-sm text-gray-600">{formatDate(tx.created_at)}</TableCell>
                          <TableCell>
                            <Badge
                              variant={isCredit ? "default" : "secondary"}
                              className={`text-xs ${isCredit ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-100" : "bg-red-100 text-red-600 border-red-200 hover:bg-red-100"}`}
                            >
                              {txTypeLabel(tx.transaction_type)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {tx.shop_name
                              ? <Badge variant="outline" className="font-normal border-amber-200 text-amber-700 bg-amber-50">{tx.shop_name}</Badge>
                              : <span className="text-gray-300">-</span>}
                          </TableCell>
                          <TableCell className="text-sm text-gray-600">
                            <span className="flex items-center gap-1">
                              {tx.description || <span className="text-gray-300">-</span>}
                              {hasReceipt && <ChevronRight className="h-3.5 w-3.5 text-orange-400" />}
                            </span>
                          </TableCell>
                          <TableCell className={`text-right font-bold tabular-nums ${isCredit ? "text-green-600" : "text-red-500"}`}>
                            {isCredit ? "+" : "-"}{formatTHB(Math.abs(tx.amount))}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium text-gray-600 tabular-nums">{formatTHB(tx.balance_after)}</TableCell>
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
      <ReceiptDetailDialog
        receiptId={openReceiptId}
        onClose={() => setOpenReceiptId(null)}
      />
    </div>
  );
}
