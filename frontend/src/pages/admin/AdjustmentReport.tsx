import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { formatCurrency as formatTHB } from "@/lib/format";
import { exportToPDF, exportToExcel } from "@/lib/reportExport";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { FileSpreadsheet, FileText, Search, ClipboardList } from "lucide-react";

interface AdjustmentRow {
  id: number;
  created_at: string;
  entity_type: string;
  entity_name: string;
  entity_code: string;
  direction: "credit" | "debit";
  amount: number;
  balance_before: number;
  balance_after: number;
  reason: string | null;
  reference_ticket: string | null;
  adjusted_by: string;
}


const formatDT = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

const ENTITY_COLORS: Record<string, string> = {
  student: "bg-blue-100 text-blue-800",
  parent: "bg-purple-100 text-purple-800",
  staff: "bg-amber-100 text-amber-800",
  admin: "bg-red-100 text-red-800",
  department: "bg-green-100 text-green-800",
};

export default function AdjustmentReport() {
  const { t } = useTranslation();
  const schoolInfo = useSchoolInfo();

  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + "-01";

  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [direction, setDirection] = useState<"all" | "credit" | "debit">("all");
  const [rows, setRows] = useState<AdjustmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (direction !== "all") params.set("direction", direction);
      const data = await api.get<AdjustmentRow[]>(
        `/wallets/admin/adjustment-report?${params.toString()}`
      );
      const sorted = [...data].sort((a, b) => b.created_at.localeCompare(a.created_at));
      setRows(sorted);
      setSearched(true);
      if (data.length === 0) {
        toast({ title: t("adjustmentReport.noResults", "No adjustments found for the selected filters.") });
      }
    } catch (e) {
      toast({
        title: t("adjustmentReport.loadError", "Failed to load report"),
        description: e instanceof ApiError ? e.detail : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filterLabel = [
    dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : dateFrom ? `From ${dateFrom}` : dateTo ? `To ${dateTo}` : "All dates",
    direction !== "all" ? `Direction: ${direction}` : null,
  ].filter(Boolean).join("  |  ");

  const COLUMNS = [
    { header: "Date / Time",      key: "created_at",     format: "datetime" as const, width: 18 },
    { header: "Type",             key: "entity_type",    format: "text" as const,     width: 12 },
    { header: "Name",             key: "entity_name",    format: "text" as const,     width: 24 },
    { header: "Code",             key: "entity_code",    format: "text" as const,     width: 16 },
    { header: "Direction",        key: "direction",      format: "text" as const,     width: 10 },
    { header: "Amount (฿)",       key: "amount",         format: "currency" as const, width: 14, align: "right" as const },
    { header: "Balance Before",   key: "balance_before", format: "currency" as const, width: 14, align: "right" as const },
    { header: "Balance After",    key: "balance_after",  format: "currency" as const, width: 14, align: "right" as const },
    { header: "Reason",           key: "reason",         format: "text" as const,     width: 30 },
    { header: "Ref / Ticket",     key: "reference_ticket", format: "text" as const,   width: 16 },
    { header: "Adjusted By",      key: "adjusted_by",    format: "text" as const,     width: 20 },
  ];

  const exportRows = rows.map((r) => ({
    ...r,
    reason: r.reason ?? "",
    reference_ticket: r.reference_ticket ?? "",
  }));

  const totals = {
    entity_name: `${rows.length} records`,
    amount: rows.reduce((s, r) => s + (r.direction === "credit" ? r.amount : -r.amount), 0),
  };

  const handleExcelExport = () => {
    exportToExcel(
      {
        meta: {
          title: "Wallet Adjustment Report",
          schoolName: schoolInfo?.name ?? "ISB",
          filters: [filterLabel],
        },
        columns: COLUMNS,
        rows: exportRows,
        totals,
      },
      `WalletAdjustments_${dateFrom}_${dateTo}`
    );
  };

  const handlePdfExport = async () => {
    await exportToPDF(
      {
        meta: {
          title: "Wallet Adjustment Report",
          schoolName: schoolInfo?.name ?? "ISB",
          schoolLogoUrl: schoolInfo?.logoUrl || undefined,
          filters: [filterLabel],
        },
        columns: COLUMNS,
        rows: exportRows,
        totals,
      },
      `WalletAdjustments_${dateFrom}_${dateTo}.pdf`
    );
  };

  const creditTotal = rows.filter((r) => r.direction === "credit").reduce((s, r) => s + r.amount, 0);
  const debitTotal  = rows.filter((r) => r.direction === "debit").reduce((s, r) => s + r.amount, 0);

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <ClipboardList className="h-6 w-6" />
          {t("adjustmentReport.title", "Wallet Adjustment Report")}
        </h1>
        <p className="page-description">
          {t("adjustmentReport.description", "Audit trail for all manual wallet credit/debit adjustments.")}
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("adjustmentReport.filters", "Filters")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="date-from">{t("adjustmentReport.dateFrom", "From")}</Label>
              <DatePicker
                id="date-from"
                value={dateFrom}
                onChange={setDateFrom}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="date-to">{t("adjustmentReport.dateTo", "To")}</Label>
              <DatePicker
                id="date-to"
                value={dateTo}
                onChange={setDateTo}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("adjustmentReport.direction", "Direction")}</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as typeof direction)}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="credit">+</SelectItem>
                  <SelectItem value="debit">−</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={load} disabled={loading} className="gap-2">
              <Search className="h-4 w-4" />
              {loading ? t("adjustmentReport.loading", "Loading…") : t("adjustmentReport.search", "Search")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary + Export */}
      {searched && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="text-muted-foreground">{rows.length} records</span>
            <Badge variant="outline" className="text-green-700 border-green-300">
              + {formatTHB(creditTotal)}
            </Badge>
            <Badge variant="outline" className="text-destructive border-destructive/30">
              − {formatTHB(debitTotal)}
            </Badge>
            <Badge variant="secondary">
              Net: {formatTHB(creditTotal - debitTotal)}
            </Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExcelExport} className="gap-2">
              <FileSpreadsheet className="h-4 w-4 text-green-700" />
              Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handlePdfExport} className="gap-2">
              <FileText className="h-4 w-4 text-red-600" />
              PDF
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {searched && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Date / Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance Before</TableHead>
                    <TableHead className="text-right">Balance After</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Ref / Ticket</TableHead>
                    <TableHead>Adjusted By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                        {t("adjustmentReport.noResults", "No adjustments found.")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-xs font-mono">
                          {formatDT(r.created_at)}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${ENTITY_COLORS[r.entity_type] ?? "bg-gray-100 text-gray-700"}`}>
                            {r.entity_type}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium">{r.entity_name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-mono text-xs">
                            {r.entity_code}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={r.direction === "credit"
                              ? "text-green-700 border-green-300"
                              : "text-destructive border-destructive/30"}
                          >
                            {r.direction === "credit" ? "+" : "−"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {formatTHB(r.amount)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground text-sm">
                          {formatTHB(r.balance_before)}
                        </TableCell>
                        <TableCell className={`text-right font-mono font-semibold ${r.balance_after < 0 ? "text-destructive" : ""}`}>
                          {formatTHB(r.balance_after)}
                        </TableCell>
                        <TableCell className="max-w-[220px] text-sm">
                          <span title={r.reason ?? ""} className="line-clamp-2">
                            {r.reason || <span className="text-muted-foreground italic">—</span>}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm font-mono">
                          {r.reference_ticket || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-sm">{r.adjusted_by}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
