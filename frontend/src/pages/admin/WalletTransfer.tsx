import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { fmtDateTime, todayBangkok } from "@/lib/dateFormat";
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

const TX_PAGE_SIZE = 20;

// From / To each render as a group caption spanning their two sub-columns, so the
// sub-header here is just "ISB ID" / "Name" — TX_COLUMN_GROUPS below supplies the
// captions. Ungrouped columns repeat their own header in the caption band.
const TX_COLUMNS = [
  { header: "No.",         key: "seq",           format: "text" as const,     width: 6,  align: "right" as const },
  { header: "Date / Time", key: "created_at",    format: "datetime" as const, width: 18 },
  { header: "ISB ID",      key: "from_code",     format: "text" as const,     width: 14 },
  { header: "Name",        key: "from_name",     format: "text" as const,     width: 22 },
  { header: "ISB ID",      key: "to_code",       format: "text" as const,     width: 14 },
  { header: "Name",        key: "to_name",       format: "text" as const,     width: 22 },
  { header: "Amount (฿)",  key: "amount",        format: "currency" as const, width: 14, align: "right" as const },
  { header: "Note",        key: "note",          format: "text" as const,     width: 24 },
];

const TX_COLUMN_GROUPS = [
  { colSpan: 1 },                    // No.
  { colSpan: 1 },                    // Date / Time
  { label: "From", colSpan: 2 },
  { label: "To",   colSpan: 2 },
  { colSpan: 1 },                    // Amount
  { colSpan: 1 },                    // Note
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

  // One payload for both exporters so PDF and Excel can never drift apart.
  // The record count rides on totalsLabel rather than occupying a column: that
  // keeps every cell between the label and Amount empty, which lets the TOTAL
  // row merge into two clean blocks instead of a run of bordered blanks.
  const buildTxPayload = () => ({
    columns: TX_COLUMNS,
    columnGroups: TX_COLUMN_GROUPS,
    rows: txHistory.map((r, i) => ({
      ...r,
      seq: (txPage - 1) * TX_PAGE_SIZE + i + 1,
      note: r.note ?? "",
    })),
    totalsLabel: `TOTAL (${txTotal} records)`,
    totals: { amount: txHistory.reduce((s, r) => s + r.amount, 0) },
  });

  const handleTxExcel = () => {
    const today = todayBangkok();
    exportToExcel(
      { meta: { title: "Wallet Transfer Report", schoolName: schoolInfo?.name ?? "ISB", filters: [`All transfers — page ${txPage}`] }, ...buildTxPayload() },
      `WalletTransfers_${today}`,
    );
  };

  const handleTxPdf = () => {
    const today = todayBangkok();
    exportToPDF(
      { meta: { title: "Wallet Transfer Report", schoolName: schoolInfo?.name ?? "ISB", schoolLogoUrl: schoolInfo?.logoUrl || undefined, filters: [`All transfers — page ${txPage}`] }, ...buildTxPayload() },
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
              {/* "by" dropped from the label along with the By column — the backend
                  still matches it, so old searches keep working, but nothing
                  advertises a field that is no longer on screen. */}
              <Label className="text-sm">{t("admin.walletTransfer.filterSearch", "Search (name / ISB ID)")}</Label>
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
                    <TableRow className="bg-muted/40">
                      <TableHead rowSpan={2} className="w-12 text-right">No.</TableHead>
                      <TableHead rowSpan={2} className="whitespace-nowrap">
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
                      <TableHead colSpan={2} className="text-center">From</TableHead>
                      <TableHead colSpan={2} className="text-center">To</TableHead>
                      <TableHead rowSpan={2} className="text-right">Amount</TableHead>
                      <TableHead rowSpan={2}>Note</TableHead>
                    </TableRow>
                    <TableRow className="bg-muted/40">
                      <TableHead className="whitespace-nowrap">ISB ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="whitespace-nowrap">ISB ID</TableHead>
                      <TableHead>Name</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txHistory.map((tx, i) => (
                      <TableRow key={tx.id}>
                        <TableCell className="text-right text-xs font-mono text-muted-foreground">
                          {(txPage - 1) * TX_PAGE_SIZE + i + 1}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs font-mono">{fmtDateTime(tx.created_at)}</TableCell>
                        <TableCell className="text-xs font-mono">{tx.from_code || "—"}</TableCell>
                        <TableCell className="font-medium text-sm">{tx.from_name}</TableCell>
                        <TableCell className="text-xs font-mono">{tx.to_code || "—"}</TableCell>
                        <TableCell className="font-medium text-sm">{tx.to_name}</TableCell>
                        <TableCell className="text-right font-mono font-semibold text-green-700">
                          {formatTHBTx(tx.amount)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">
                          {tx.note || "—"}
                        </TableCell>
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
