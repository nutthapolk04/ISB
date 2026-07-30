import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { PaginationBar } from "@/components/PaginationBar";
import { SortableDateTimeHeader } from "@/components/SortableDateTimeHeader";
import { DEFAULT_DATE_TIME_SORT, toggleDateTimeSort, type DateTimeSortDir } from "@/lib/dateTimeSort";
import {
  exportToPDF,
  exportToExcel,
  buildDateFilterLine,
  type ReportPayload,
} from "@/lib/reportExport";
import { toast } from "@/components/ui/sonner";
import { Wallet, Loader2, Store as StoreIcon, FileText, FileSpreadsheet } from "lucide-react";

interface TopupRow {
  id: number;
  created_at: string;
  channel: "kiosk" | "online" | "cashier";
  topped_by: string;
  recipient_name: string;
  recipient_code: string;
  amount: number;
  cashier_name: string | null;
}

const CHANNEL_LABEL: Record<string, string> = {
  kiosk: "Kiosk",
  online: "Online (Parent)",
  cashier: "Cashier (Store)",
};

interface TopupReportData {
  items: TopupRow[];
  total: number;
  amount_total: number;
  page: number;
  pages: number;
}

const PAGE_SIZE = 50;
/** Export re-fetches every row matching the current filters (uncapped by the
 * on-screen page size) — mirrors AdminReports.tsx's TXN_EXPORT_PAGE_SIZE so
 * exporting never silently covers only whichever page happens to be showing. */
const EXPORT_PAGE_SIZE = 5000;

export default function StoreTopupReport() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const school = useSchoolInfo();
  const shopId = user?.shopId ?? null;
  const shopName = user?.shopName ?? "—";

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateTimeSort, setDateTimeSort] = useState<DateTimeSortDir>(DEFAULT_DATE_TIME_SORT);
  const [data, setData] = useState<TopupReportData | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [exporting, setExporting] = useState(false);

  const buildParams = (p: number, sort = dateTimeSort) => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    params.set("sort_order", sort);
    params.set("page", String(p));
    params.set("page_size", String(PAGE_SIZE));
    return params;
  };

  const loadPage = async (p: number, sort = dateTimeSort) => {
    if (!shopId) return;
    setLoading(true);
    try {
      const params = buildParams(p, sort);
      const result = await api.get<TopupReportData>(`/shops/${shopId}/topup-report?${params.toString()}`);
      setData(result);
      setPage(result.page);
      setSearched(true);
      if (result.items.length === 0) toast.message(t("store.topupReport.noResults", "No top-ups match these filters."));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : t("shopUsers.errorGeneric"));
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => loadPage(1);

  const handleToggleSort = async () => {
    const next = toggleDateTimeSort(dateTimeSort);
    setDateTimeSort(next);
    if (searched) await loadPage(page, next);
  };

  const buildPayload = async (): Promise<{ payload: ReportPayload<Record<string, unknown>>; baseFilename: string } | null> => {
    if (!shopId || !data) return null;
    const filters: string[] = [`Shop: ${shopName}`];
    const dateLine = buildDateFilterLine("Date", dateFrom, dateTo);
    if (dateLine) filters.push(dateLine);
    const dateLabel = `_${dateFrom}_${dateTo}`;

    // Paginated on screen — export re-fetches every row matching the current
    // filters (capped at EXPORT_PAGE_SIZE), same reasoning as the Admin
    // Top-up Report's own export.
    const params = buildParams(1, dateTimeSort);
    params.set("page_size", String(EXPORT_PAGE_SIZE));
    const full = await api.get<TopupReportData>(`/shops/${shopId}/topup-report?${params.toString()}`);

    return {
      payload: {
        meta: {
          title: t("store.topupReport.title", "Top-up Report"),
          schoolName: school.name,
          schoolLogoUrl: school.logoUrl || undefined,
          reportId: "ISB-STORE-TOPUP",
          filters,
          runByName: user?.fullName ?? user?.username,
        },
        columns: [
          { header: t("admin.adminReports.colDateTime", "Date/Time"), key: "created_at", format: "datetime", width: 20 },
          { header: t("admin.adminReports.colChannel", "Type"), key: "channel_label", width: 16 },
          { header: t("admin.adminReports.colToppedBy", "Topped By"), key: "topped_by", width: 24 },
          { header: t("admin.adminReports.colRecipient", "Recipient"), key: "recipient_name", width: 24 },
          { header: t("admin.adminReports.colAmount", "Amount"), key: "amount", format: "currency", align: "right", width: 14 },
          { header: t("admin.adminReports.colCashier", "Cashier / Source"), key: "cashier_name", width: 20 },
        ],
        rows: full.items.map((r) => ({
          ...r,
          channel_label: CHANNEL_LABEL[r.channel] ?? r.channel,
          cashier_name: r.cashier_name ?? "",
        })) as unknown as Record<string, unknown>[],
        totals: { amount: full.amount_total },
      },
      baseFilename: `StoreTopupReport${dateLabel}`,
    };
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const result = await buildPayload();
      if (!result) return;
      await exportToPDF(result.payload, `${result.baseFilename}.pdf`);
      toast.success(t("reports.exportSuccess", "Export successful"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : e instanceof Error ? e.message : t("shopUsers.errorGeneric"));
    } finally {
      setExporting(false);
    }
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const result = await buildPayload();
      if (!result) return;
      exportToExcel(result.payload, `${result.baseFilename}.xlsx`);
      toast.success(t("reports.exportSuccess", "Export successful"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : e instanceof Error ? e.message : t("shopUsers.errorGeneric"));
    } finally {
      setExporting(false);
    }
  };

  if (!shopId) {
    return (
      <div className="page-shell">
        <div className="py-16 text-center text-muted-foreground">
          <StoreIcon className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p>{t("store.topupReport.noShop", "No shop assigned to your account.")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header flex items-center gap-3">
        <Wallet className="h-7 w-7 text-primary" />
        <div>
          <h1 className="page-title">{t("store.topupReport.title", "Top-up Report")}</h1>
          <p className="page-description">
            {t("store.topupReport.subtitle", "Wallet top-ups performed at this shop's POS")}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{shopName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2 md:col-span-2 lg:col-span-2">
              <Label>{t("reports.startDate", "Start date")} — {t("reports.endDate", "End date")}</Label>
              <DateRangePicker
                startDate={dateFrom}
                endDate={dateTo}
                onStartChange={setDateFrom}
                onEndChange={setDateTo}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("admin.adminReports.toppedByFilter", "Topped by")}</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                {shopName}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSearch} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("adjustmentReport.search", "Search")}
            </Button>
            {searched && data && (
              <>
                <Button variant="outline" onClick={handleExportPdf} disabled={exporting}>
                  {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                  {t("reports.exportPdf", "Export PDF")}
                </Button>
                <Button variant="outline" onClick={handleExportExcel} disabled={exporting}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  {t("reports.exportExcel", "Export Excel")}
                </Button>
              </>
            )}
          </div>

          {searched && data && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {t("store.topupReport.found", "Found")}{" "}
                <span className="font-semibold text-foreground">{data.total}</span>{" "}
                {t("store.topupReport.topups", "top-ups")}
                {" · "}
                {t("store.topupReport.total", "Total")}{" "}
                <span className="font-semibold text-foreground">
                  ฿{data.amount_total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 whitespace-nowrap">
                    <tr>
                      <SortableDateTimeHeader
                        label={t("admin.adminReports.colDateTime", "Date/Time")}
                        sortDir={dateTimeSort}
                        onToggle={handleToggleSort}
                      />
                      <th className="px-2 py-2 text-left">{t("admin.adminReports.colChannel", "Type")}</th>
                      <th className="px-2 py-2 text-left">{t("admin.adminReports.colToppedBy", "Topped By")}</th>
                      <th className="px-2 py-2 text-left">{t("admin.adminReports.colRecipient", "Recipient")}</th>
                      <th className="px-2 py-2 text-right">{t("admin.adminReports.colAmount", "Amount")}</th>
                      <th className="px-2 py-2 text-left">{t("admin.adminReports.colCashier", "Cashier / Source")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                          {t("store.topupReport.noResults", "No top-ups match these filters.")}
                        </td>
                      </tr>
                    ) : (
                      data.items.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="px-2 py-1.5 whitespace-nowrap">{r.created_at.slice(0, 19).replace("T", " ")}</td>
                          <td className="px-2 py-1.5">{CHANNEL_LABEL[r.channel] ?? r.channel}</td>
                          <td className="px-2 py-1.5">{r.topped_by}</td>
                          <td className="px-2 py-1.5">
                            {r.recipient_name} <span className="text-muted-foreground font-mono">({r.recipient_code})</span>
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.amount.toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{r.cashier_name ?? ""}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {data.items.length > 0 && (
                    <tfoot className="bg-muted/30 font-semibold whitespace-nowrap">
                      <tr className="border-t">
                        <td colSpan={4} className="px-2 py-2 text-left">
                          {t("store.topupReport.totalRow", "TOTAL")}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">{data.amount_total.toFixed(2)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {data.pages > 1 && (
                <div className="flex justify-center">
                  <PaginationBar currentPage={page} totalPages={data.pages} onPageChange={(p) => loadPage(p)} />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
