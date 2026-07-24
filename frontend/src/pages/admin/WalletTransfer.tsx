import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/dateFormat";
import { exportToPDF, exportToExcel } from "@/lib/reportExport";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { SortableDateTimeHeader } from "@/components/SortableDateTimeHeader";
import { DEFAULT_DATE_TIME_SORT, toggleDateTimeSort, type DateTimeSortDir } from "@/lib/dateTimeSort";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  History,
  Search,
} from "lucide-react";

interface TransferHistoryRow {
  id: number;
  created_at: string;
  from_name: string;
  from_code: string;
  to_name: string;
  to_code: string;
  amount: number;
  note: string | null;
  transferred_by: string;
}

interface TransferHistoryResponse {
  items: TransferHistoryRow[];
  total: number;
  page: number;
  pages: number;
}

const TX_COLUMNS = [
  { header: "Date / Time", key: "created_at",    format: "datetime" as const, width: 18 },
  { header: "From",        key: "from_name",     format: "text" as const,     width: 22 },
  { header: "From Code",   key: "from_code",     format: "text" as const,     width: 14 },
  { header: "To",          key: "to_name",       format: "text" as const,     width: 22 },
  { header: "To Code",     key: "to_code",       format: "text" as const,     width: 14 },
  { header: "Amount (฿)",  key: "amount",        format: "currency" as const, width: 14, align: "right" as const },
  { header: "Note",        key: "note",          format: "text" as const,     width: 24 },
  { header: "By",          key: "transferred_by",format: "text" as const,     width: 18 },
];

const formatTHBTx = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);

export default function WalletTransfer() {
  const { t } = useTranslation();
  const schoolInfo = useSchoolInfo();

  const [txHistory, setTxHistory] = useState<TransferHistoryRow[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txPage, setTxPage] = useState(1);
  const [txPages, setTxPages] = useState(1);
  const [txLoading, setTxLoading] = useState(false);
  const [txDateFrom, setTxDateFrom] = useState("");
  const [txDateTo, setTxDateTo] = useState("");
  const [txQuery, setTxQuery] = useState("");
  const [txAmountMin, setTxAmountMin] = useState("");
  const [txAmountMax, setTxAmountMax] = useState("");
  const [txDateTimeSort, setTxDateTimeSort] = useState<DateTimeSortDir>(DEFAULT_DATE_TIME_SORT);

  const loadHistory = async (page = 1, sort = txDateTimeSort) => {
    setTxLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "20", sort_order: sort });
      if (txDateFrom) params.set("date_from", txDateFrom);
      if (txDateTo) params.set("date_to", txDateTo);
      if (txQuery.trim()) params.set("q", txQuery.trim());
      if (txAmountMin.trim()) params.set("amount_min", txAmountMin.trim());
      if (txAmountMax.trim()) params.set("amount_max", txAmountMax.trim());
      const data = await api.get<TransferHistoryResponse>(
        `/wallets/admin/transfer-report?${params.toString()}`
      );
      setTxHistory(data.items);
      setTxTotal(data.total);
      setTxPage(data.page);
      setTxPages(data.pages);
    } catch {
      /* silently ignore — not critical */
    } finally {
      setTxLoading(false);
    }
  };

  useEffect(() => { loadHistory(1); }, []);

  const handleTxExcel = () => {
    const today = new Date().toISOString().slice(0, 10);
    exportToExcel(
      { meta: { title: "Wallet Transfer Report", schoolName: schoolInfo?.name ?? "ISB", filters: [`All transfers — page ${txPage}`] }, columns: TX_COLUMNS, rows: txHistory.map((r) => ({ ...r, note: r.note ?? "" })), totals: { from_name: `${txTotal} records`, amount: txHistory.reduce((s, r) => s + r.amount, 0) } },
      `WalletTransfers_${today}`,
    );
  };

  const handleTxPdf = () => {
    const today = new Date().toISOString().slice(0, 10);
    exportToPDF(
      { meta: { title: "Wallet Transfer Report", schoolName: schoolInfo?.name ?? "ISB", schoolLogoUrl: schoolInfo?.logoUrl || undefined, filters: [`All transfers — page ${txPage}`] }, columns: TX_COLUMNS, rows: txHistory.map((r) => ({ ...r, note: r.note ?? "" })), totals: { from_name: `${txTotal} records`, amount: txHistory.reduce((s, r) => s + r.amount, 0) } },
      `WalletTransfers_${today}.pdf`,
    );
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <ArrowLeftRight className="h-6 w-6" />
          {t("admin.walletTransfer.title")}
        </h1>
        <p className="page-description">
          {t("admin.walletTransfer.reportOnlyDescription", "Read-only history of every wallet-to-wallet transfer.")}
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-sm">{t("adjustmentReport.dateFrom", "From")}</Label>
              <DatePicker value={txDateFrom} onChange={setTxDateFrom} className="w-36 h-9 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-sm">{t("adjustmentReport.dateTo", "To")}</Label>
              <DatePicker value={txDateTo} onChange={setTxDateTo} className="w-36 h-9 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-sm">{t("admin.walletTransfer.filterSearch", "Search (name / code / by)")}</Label>
              <Input
                value={txQuery}
                onChange={(e) => setTxQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadHistory(1)}
                placeholder={t("admin.walletTransfer.filterSearchPlaceholder", "e.g. Somchai or 202266")}
                className="w-56 h-9 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-sm">{t("admin.walletTransfer.filterAmountMin", "Min amount")}</Label>
              <Input
                type="number"
                min="0"
                value={txAmountMin}
                onChange={(e) => setTxAmountMin(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadHistory(1)}
                placeholder="0"
                className="w-28 h-9 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-sm">{t("admin.walletTransfer.filterAmountMax", "Max amount")}</Label>
              <Input
                type="number"
                min="0"
                value={txAmountMax}
                onChange={(e) => setTxAmountMax(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadHistory(1)}
                placeholder={t("admin.walletTransfer.filterAmountMaxPlaceholder", "No limit")}
                className="w-28 h-9 text-sm"
              />
            </div>
            <Button size="sm" onClick={() => loadHistory(1)} disabled={txLoading} className="gap-1.5 h-9">
              <Search className="h-3.5 w-3.5" />
              {txLoading ? "…" : t("adjustmentReport.search", "Search")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <History className="h-4 w-4" />
            {t("admin.walletTransfer.historyTitle", "Transfer History")}
            {txTotal > 0 && <span className="text-sm text-muted-foreground font-normal">({txTotal} total)</span>}
          </h2>
          {txHistory.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleTxExcel} className="gap-1.5 h-8">
                <FileSpreadsheet className="h-3.5 w-3.5 text-green-700" />Excel
              </Button>
              <Button variant="outline" size="sm" onClick={handleTxPdf} className="gap-1.5 h-8">
                <FileText className="h-3.5 w-3.5 text-red-600" />PDF
              </Button>
            </div>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            {txLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : txHistory.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("admin.walletTransfer.noHistory", "No transfers yet.")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">
                        <SortableDateTimeHeader
                          label="Date / Time"
                          sortDir={txDateTimeSort}
                          inline
                          onToggle={async () => {
                            const next = toggleDateTimeSort(txDateTimeSort);
                            setTxDateTimeSort(next);
                            await loadHistory(txPage, next);
                          }}
                        />
                      </TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txHistory.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="whitespace-nowrap text-xs font-mono">{fmtDateTime(tx.created_at)}</TableCell>
                        <TableCell>
                          <p className="font-medium text-sm">{tx.from_name}</p>
                          <p className="text-xs font-mono text-muted-foreground">{tx.from_code}</p>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-sm">{tx.to_name}</p>
                          <p className="text-xs font-mono text-muted-foreground">{tx.to_code}</p>
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold text-green-700">
                          {formatTHBTx(tx.amount)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">
                          {tx.note || "—"}
                        </TableCell>
                        <TableCell className="text-sm">{tx.transferred_by}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {txPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-sm text-muted-foreground">
                  Page {txPage} of {txPages}
                </p>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => { loadHistory(txPage - 1); }} disabled={txPage === 1}>
                    <ChevronLeft className="h-4 w-4" />{t("common.prev", "Prev")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { loadHistory(txPage + 1); }} disabled={txPage === txPages}>
                    {t("common.next", "Next")}<ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
