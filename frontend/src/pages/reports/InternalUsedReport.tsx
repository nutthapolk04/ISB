import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import {
  exportToPDF,
  exportToExcel,
  buildDateFilterLine,
  SECTION_KEY,
  EMPHASIS_KEY,
  type ReportColumn,
} from "@/lib/reportExport";
import { DEFAULT_DATE_TIME_SORT, toggleDateTimeSort, type DateTimeSortDir } from "@/lib/dateTimeSort";
import { InternalUsedTable, type InternalUsedReportData } from "@/components/reports/InternalUsedTable";
import type { CanteenShop } from "./reportHelpers";

interface Props {
  isCanteenReportsPage: boolean;
  needsShopSelector: boolean;
  selectedStall: string;
  canteenStalls: CanteenShop[];
  reportId: string;
}

export function InternalUsedReportPanel({
  isCanteenReportsPage,
  needsShopSelector,
  selectedStall,
  canteenStalls,
  reportId,
}: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const school = useSchoolInfo();

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [searched, setSearched] = useState(false);
  const [data, setData] = useState<InternalUsedReportData | null>(null);
  const [dateTimeSort, setDateTimeSort] = useState<DateTimeSortDir>(DEFAULT_DATE_TIME_SORT);

  const buildQuery = (sort = dateTimeSort) => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    params.set("sort_order", sort);
    if (needsShopSelector) {
      if (selectedStall === "all") params.set("module", isCanteenReportsPage ? "canteen" : "store");
      else params.set("shop_id", selectedStall);
    } else if (user?.shopId) {
      params.set("shop_id", user.shopId);
    }
    return params.toString();
  };

  const loadReport = async (sort = dateTimeSort) => {
    setLoading(true);
    try {
      const qs = buildQuery(sort);
      const result = await api.get<InternalUsedReportData>(`/reports/internal-used${qs ? `?${qs}` : ""}`);
      setData(result);
      setSearched(true);
      if (result.groups.length === 0) {
        toast.message(t("admin.adminReports.internalUsedEmpty", "No internal-use receipts match these filters."));
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric"));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleDateTimeSort = async () => {
    const next = toggleDateTimeSort(dateTimeSort);
    setDateTimeSort(next);
    if (searched) await loadReport(next);
  };

  const buildFilterLines = (): string[] => {
    const lines: string[] = [];
    const dateLine = buildDateFilterLine("Date", dateFrom, dateTo);
    if (dateLine) lines.push(dateLine);
    if (needsShopSelector) {
      if (selectedStall === "all") {
        lines.push(`Module: ${isCanteenReportsPage ? "Canteen" : "Store"}`);
      } else {
        const shop = canteenStalls.find((s) => s.id === selectedStall);
        lines.push(`Shop: ${shop?.name ?? selectedStall}`);
      }
    } else if (user?.shopId) {
      lines.push(`Shop: ${user.shopName ?? user.shopId}`);
    }
    return lines;
  };

  const buildExportPayload = async () => {
    const qs = buildQuery();
    const full = await api.get<InternalUsedReportData>(`/reports/internal-used${qs ? `?${qs}` : ""}`);
    const columns: ReportColumn[] = [
      { header: t("admin.adminReports.colDateTime"), key: "created_at", format: "datetime", width: 20 },
      { header: t("admin.adminReports.colReceiptNo"), key: "receipt_number", width: 16 },
      { header: t("admin.adminReports.colAmountReceived"), key: "amount", format: "currency", align: "right", width: 14 },
      { header: t("admin.adminReports.colStaffId"), key: "staff_id", width: 16 },
      { header: t("admin.adminReports.colStaffName"), key: "staff_name", width: 24 },
      { header: t("admin.adminReports.colRemarks"), key: "remarks", width: 24 },
      { header: t("admin.adminReports.colStatus"), key: "status", width: 10 },
    ];
    const bodyRows: Record<string, unknown>[] = [];
    for (const g of full.groups) {
      bodyRows.push({ [SECTION_KEY]: `Department code : ${g.department_code}   ${g.department_name}` });
      bodyRows.push(...g.rows.map((r) => ({ ...r, remarks: r.remarks ?? "" })));
      bodyRows.push({
        [EMPHASIS_KEY]: "total" as const,
        receipt_number: t("admin.adminReports.totalByDepartment", "Total by Department"),
        amount: g.subtotal,
      });
    }
    return {
      meta: {
        title: t("admin.adminReports.internalUsedReport"),
        schoolName: school.name,
        schoolLogoUrl: school.logoUrl || undefined,
        reportId,
        filters: buildFilterLines(),
        runByName: user?.fullName ?? user?.username,
      },
      columns,
      rows: bodyRows,
      totals: { amount: full.grand_total },
    };
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const payload = await buildExportPayload();
      const dateLabel = `_${dateFrom || "all"}_${dateTo || "all"}`;
      await exportToPDF(payload, `InternalUsedReport${dateLabel}.pdf`);
      toast.success(t("reports.exportSuccess"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric"));
    } finally {
      setExporting(false);
    }
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const payload = await buildExportPayload();
      const dateLabel = `_${dateFrom || "all"}_${dateTo || "all"}`;
      await exportToExcel(payload, `InternalUsedReport${dateLabel}`);
      toast.success(t("reports.exportSuccess"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          {t("admin.adminReports.internalUsedReport")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t("reports.startDate")} — {t("reports.endDate")}</Label>
          <DateRangePicker
            startDate={dateFrom}
            endDate={dateTo}
            onStartChange={setDateFrom}
            onEndChange={setDateTo}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => loadReport()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {t("reports.search", "Search")}
          </Button>
          {searched && data && data.groups.length > 0 && (
            <>
              <Button variant="outline" onClick={handleExportPdf} disabled={exporting}>
                {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                {t("reports.exportPdf")}
              </Button>
              <Button variant="outline" onClick={handleExportExcel} disabled={exporting}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                {t("reports.exportExcel")}
              </Button>
            </>
          )}
        </div>
        {searched && data && (
          <InternalUsedTable
            data={data}
            dateTimeSort={dateTimeSort}
            onToggleDateTimeSort={handleToggleDateTimeSort}
          />
        )}
      </CardContent>
    </Card>
  );
}
