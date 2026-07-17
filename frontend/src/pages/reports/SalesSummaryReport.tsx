import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import {
  exportToPDF,
  exportToExcel,
  buildDateFilterLine,
  SECTION_KEY,
  EMPHASIS_KEY,
  type ReportColumn,
  type ReportPayload,
} from "@/lib/reportExport";
import { buildVendorSections, isMultiVendor, type CanteenShop } from "./reportHelpers";

// Per-receipt summary with payment-method breakdown. Mirrors the backend
// /api/v1/reports/sales-summary contract. Every filter is optional and an
// empty form returns every active receipt the caller is allowed to see.

interface SalesSummaryRow {
  seq: number;
  transaction_date: string;     // ISO datetime
  receipt_number: string;
  customer_id: string | null;
  customer_name: string | null;
  amt_receive: number;
  amt_change: number;
  amt_billing: number;
  amt_cash: number;
  amt_campus_card: number;
  amt_credit_card: number;
  amt_qr_code: number;
  amt_other: number;
  remark: string | null;
  shop_id: string;
  shop_name: string | null;
  bundle_names: string | null;
  status: string;
}

interface SalesSummaryTotals {
  amt_receive: number;
  amt_change: number;
  amt_billing: number;
  amt_cash: number;
  amt_campus_card: number;
  amt_credit_card: number;
  amt_qr_code: number;
  amt_other: number;
}

interface SalesSummaryReportData {
  date_from: string | null;
  date_to: string | null;
  shop_id: string | null;
  rows: SalesSummaryRow[];
  totals: SalesSummaryTotals;
  receipt_count: number;
}

// Receive-type filter options for the Sales Summary panel. Values match the
// backend's _RECEIVE_TYPE_GROUPS keys. Labels stay English — international
// school.
const RECEIVE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "all",        label: "All" },
  { value: "cash",       label: "Cash" },
  { value: "wallet",     label: "Campus Card (Wallet)" },
  { value: "credit",     label: "Credit Card" },
  { value: "qr",         label: "QR Code" },
  { value: "department", label: "Department Billing" },
  { value: "other",      label: "Other" },
];

// Customer type filter — matches CustomerTypeEnum on the backend.
const CUSTOMER_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "all",     label: "All" },
  { value: "parent",  label: "Parent" },
  { value: "student", label: "Student" },
  { value: "staff",   label: "Staff" },
  { value: "guest",   label: "Guest" },
];

interface SalesSummaryReportProps {
  reportId: string;
  needsShopSelector: boolean;
  isCanteenReportsPage: boolean;
  selectedStall: string;
  onSelectedStallChange: (v: string) => void;
  canteenStalls: CanteenShop[];
}

export function SalesSummaryReport({
  reportId,
  needsShopSelector,
  isCanteenReportsPage,
  selectedStall,
  onSelectedStallChange,
  canteenStalls,
}: SalesSummaryReportProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const school = useSchoolInfo();

  const [ssDateFrom, setSsDateFrom] = useState("");
  const [ssDateTo, setSsDateTo] = useState("");
  const [ssCustomerType, setSsCustomerType] = useState("all");
  const [ssUserName, setSsUserName] = useState("");
  const [ssFamilyCode, setSsFamilyCode] = useState("");
  const [ssReceiptNoFrom, setSsReceiptNoFrom] = useState("");
  const [ssReceiptNoTo, setSsReceiptNoTo] = useState("");
  const [ssReceiveType, setSsReceiveType] = useState("all");
  const [ssLoading, setSsLoading] = useState(false);
  const [ssData, setSsData] = useState<SalesSummaryReportData | null>(null);

  /**
   * Build the /reports/sales-summary querystring. Skip empty filters so the
   * backend receives "no filter" rather than "filter == empty string".
   */
  const buildSalesSummaryQuery = (): string => {
    const params = new URLSearchParams();
    if (ssDateFrom) params.set("date_from", ssDateFrom);
    if (ssDateTo) params.set("date_to", ssDateTo);
    if (ssCustomerType && ssCustomerType !== "all") params.set("customer_type", ssCustomerType);
    if (ssUserName.trim()) params.set("user_name", ssUserName.trim());
    if (ssFamilyCode.trim()) params.set("family_code", ssFamilyCode.trim());
    if (ssReceiptNoFrom.trim()) params.set("receipt_no_from", ssReceiptNoFrom.trim());
    if (ssReceiptNoTo.trim()) params.set("receipt_no_to", ssReceiptNoTo.trim());
    if (ssReceiveType && ssReceiveType !== "all") params.set("receive_type", ssReceiveType);

    // Admin + canteen-area-manager pick a shop from the dropdown; other shop
    // users are locked to their own shop scope (handled server-side).
    if (needsShopSelector) {
      if (selectedStall === "all") params.set("module", isCanteenReportsPage ? "canteen" : "store");
      else params.set("shop_id", selectedStall);
    } else if (user?.shopId) {
      params.set("shop_id", user.shopId);
    }
    return params.toString();
  };

  const handleLoadSalesSummary = async () => {
    setSsLoading(true);
    try {
      const qs = buildSalesSummaryQuery();
      const data = await api.get<SalesSummaryReportData>(
        `/reports/sales-summary${qs ? `?${qs}` : ""}`,
      );
      setSsData(data);
      if (data.rows.length === 0) {
        toast.message("No receipts match these filters.");
      }
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric");
      toast.error(detail);
    } finally {
      setSsLoading(false);
    }
  };

  /** Translate the active filter state into "Filter: X · Y" lines for PDF/Excel headers. */
  const buildSalesSummaryFilterLines = (): string[] => {
    const lines: string[] = [];
    const dateLine = buildDateFilterLine("Date", ssDateFrom, ssDateTo);
    if (dateLine) lines.push(dateLine);
    if (ssCustomerType && ssCustomerType !== "all") {
      const label = CUSTOMER_TYPE_OPTIONS.find((o) => o.value === ssCustomerType)?.label ?? ssCustomerType;
      lines.push(`Customer Type: ${label}`);
    }
    if (ssUserName.trim()) lines.push(`Name: ${ssUserName.trim()}`);
    if (ssFamilyCode.trim()) lines.push(`Family Code: ${ssFamilyCode.trim()}`);
    if (ssReceiptNoFrom.trim() || ssReceiptNoTo.trim()) {
      const from = ssReceiptNoFrom.trim() || "—";
      const to = ssReceiptNoTo.trim() || "—";
      lines.push(`Receipt NO: ${from} → ${to}`);
    }
    if (ssReceiveType && ssReceiveType !== "all") {
      const label = RECEIVE_TYPE_OPTIONS.find((o) => o.value === ssReceiveType)?.label ?? ssReceiveType;
      lines.push(`Receive Type: ${label}`);
    }
    if (needsShopSelector && selectedStall !== "all") {
      const stall = canteenStalls.find((s) => s.id === selectedStall);
      if (stall) lines.push(`Shop: ${stall.name}`);
    }
    return lines;
  };

  const buildSalesSummaryPayload = (): ReportPayload<Record<string, unknown>> | null => {
    if (!ssData) return null;
    // Compact column headers so 14 columns can fit on a single A4 landscape
    // row without wrapping into vertical char-stacks. Header rows in the
    // helper are tight on 6.5pt font (see reportExport.ts); short strings
    // keep them readable. Widths sum to ~770pt (table width budget).
    const columns: ReportColumn[] = [
      { header: "Seq.",              key: "seq",              format: "number",   align: "right", width: 26  },
      { header: "Date/Time",        key: "transaction_date", format: "datetime", width: 90  },
      { header: "Receipt NO.",       key: "receipt_number",   width: 70  },
      { header: "ID.",               key: "customer_id",      width: 55  },
      { header: "Name",             key: "customer_name",    width: 100 },
      { header: "Amt. Receive",     key: "amt_receive",      format: "currency", width: 55 },
      { header: "Amt. Change",      key: "amt_change",       format: "currency", width: 50 },
      { header: "Amt. Billing",     key: "amt_billing",      format: "currency", width: 50 },
      { header: "Amt. Cash",        key: "amt_cash",         format: "currency", width: 50 },
      { header: "Amt. Campus card", key: "amt_campus_card",  format: "currency", width: 58 },
      { header: "Amt. Credit card", key: "amt_credit_card",  format: "currency", width: 58 },
      { header: "Amt. QR Code",     key: "amt_qr_code",      format: "currency", width: 52 },
      { header: "Amt. Department",       key: "amt_other",        format: "currency", width: 48 },
      { header: "Remark",           key: "remark",           width: 75  },
      { header: "Bundle",           key: "bundle_names",     width: 90  },
      { header: "Status",           key: "status",           width: 55  },
    ];

    const multi = isMultiVendor(ssData.rows);
    const filterLines = buildSalesSummaryFilterLines();
    let bodyRows: Record<string, unknown>[];
    if (multi) {
      bodyRows = buildVendorSections(ssData.rows, (shopRows) => {
        const active = shopRows.filter((r) => r.status === "ACTIVE");
        return {
          customer_name: "Subtotal",
          bundle_names: "",
          amt_receive:      active.reduce((s, r) => s + r.amt_receive,     0),
          amt_change:       active.reduce((s, r) => s + r.amt_change,      0),
          amt_billing:      active.reduce((s, r) => s + r.amt_billing,     0),
          amt_cash:         active.reduce((s, r) => s + r.amt_cash,        0),
          amt_campus_card:  active.reduce((s, r) => s + r.amt_campus_card, 0),
          amt_credit_card:  active.reduce((s, r) => s + r.amt_credit_card, 0),
          amt_qr_code:      active.reduce((s, r) => s + r.amt_qr_code,     0),
          amt_other:        active.reduce((s, r) => s + r.amt_other,       0),
        };
      });
    } else {
      bodyRows = ssData.rows as unknown as Record<string, unknown>[];
      // Only fill Shop from row data when the UI filter didn't already name it
      // (avoids duplicate "Shop: …" lines in PDF/Excel headers).
      if (
        ssData.rows.length > 0
        && !filterLines.some((l) => l.startsWith("Shop:"))
      ) {
        filterLines.push(`Shop: ${ssData.rows[0].shop_name ?? ssData.rows[0].shop_id}`);
      }
    }
    // Voided receipts keep showing "ACTIVE" here (customer request — the void
    // report is the record of what got voided) but flip Amt. Campus card
    // negative so the reversal is still visible. Totals/subtotals above are
    // already computed from the untouched rows, so this only affects display.
    bodyRows = bodyRows.map((row) => {
      if (SECTION_KEY in row || EMPHASIS_KEY in row) return row;
      const r = row as unknown as SalesSummaryRow;
      if (r.status === "ACTIVE") return row;
      return { ...row, amt_campus_card: -r.amt_campus_card, status: "ACTIVE" };
    });

    return {
      meta: {
        title: "Daily Sales Report",
        schoolName: school.name,
        schoolLogoUrl: school.logoUrl || undefined,
        reportId,
        filters: filterLines,
        runByName: user?.fullName ?? user?.username,
      },
      columns,
      rows: bodyRows,
      totals: {
        amt_receive: ssData.totals.amt_receive,
        amt_change: ssData.totals.amt_change,
        amt_billing: ssData.totals.amt_billing,
        amt_cash: ssData.totals.amt_cash,
        amt_campus_card: ssData.totals.amt_campus_card,
        amt_credit_card: ssData.totals.amt_credit_card,
        amt_qr_code: ssData.totals.amt_qr_code,
        amt_other: ssData.totals.amt_other,
      },
    };
  };

  const handleExportSalesSummaryPdf = async () => {
    const payload = buildSalesSummaryPayload();
    if (!payload || !ssData) return;
    try {
      const fname = `DailySalesReport_${ssDateFrom || "any"}_${ssDateTo || "any"}.pdf`;
      await exportToPDF(payload, fname);
      toast.success(t("reports.exportSuccess"));
    } catch (err) {
      const detail = err instanceof Error ? err.message : t("shopUsers.errorGeneric");
      toast.error(detail);
    }
  };

  const handleExportSalesSummaryExcel = () => {
    const payload = buildSalesSummaryPayload();
    if (!payload || !ssData) return;
    try {
      const fname = `DailySalesReport_${ssDateFrom || "any"}_${ssDateTo || "any"}.xlsx`;
      exportToExcel(payload, fname);
      toast.success(t("reports.exportSuccess"));
    } catch (err) {
      const detail = err instanceof Error ? err.message : t("shopUsers.errorGeneric");
      toast.error(detail);
    }
  };

  return (
    <div className="mt-6 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Daily Sales Report
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            All filters are optional. Leave any field blank to skip that filter.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2 md:col-span-2 lg:col-span-3">
              <Label>Date Range</Label>
              <DateRangePicker
                id="ssDateRange"
                startDate={ssDateFrom}
                endDate={ssDateTo}
                onStartChange={setSsDateFrom}
                onEndChange={setSsDateTo}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ssCustomerType">Customer Type</Label>
              <Select value={ssCustomerType} onValueChange={setSsCustomerType}>
                <SelectTrigger id="ssCustomerType"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CUSTOMER_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ssUserName">User Name</Label>
              <Input
                id="ssUserName"
                placeholder="Search user name"
                value={ssUserName}
                onChange={(e) => setSsUserName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ssFamilyCode">Family Code</Label>
              <Input
                id="ssFamilyCode"
                placeholder="Exact match"
                value={ssFamilyCode}
                onChange={(e) => setSsFamilyCode(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ssReceiptNoFrom">Receipt NO. From</Label>
              <Input
                id="ssReceiptNoFrom"
                placeholder="Optional"
                value={ssReceiptNoFrom}
                onChange={(e) => setSsReceiptNoFrom(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ssReceiptNoTo">Receipt NO. To</Label>
              <Input
                id="ssReceiptNoTo"
                placeholder="Optional"
                value={ssReceiptNoTo}
                onChange={(e) => setSsReceiptNoTo(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ssReceiveType">Receive Type</Label>
              <Select value={ssReceiveType} onValueChange={setSsReceiveType}>
                <SelectTrigger id="ssReceiveType"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RECEIVE_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {needsShopSelector && (
              <div className="space-y-2">
                <Label htmlFor="ssShop">Shop</Label>
                <Select value={selectedStall} onValueChange={onSelectedStallChange}>
                  <SelectTrigger id="ssShop"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{isCanteenReportsPage ? "All canteen stalls" : "All shops"}</SelectItem>
                    {canteenStalls.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleLoadSalesSummary} disabled={ssLoading}>
              {ssLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Search
            </Button>
            {ssData && (
              <>
                <Button variant="outline" onClick={handleExportSalesSummaryPdf}>
                  <FileText className="h-4 w-4 mr-2" />
                  Export PDF
                </Button>
                <Button variant="outline" onClick={handleExportSalesSummaryExcel}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Export Excel
                </Button>
              </>
            )}
          </div>

          {/* Results */}
          {ssData && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Found <span className="font-semibold text-foreground">{ssData.receipt_count}</span> receipts
                {" · "}Grand total{" "}
                <span className="font-semibold text-foreground">
                  ฿{ssData.totals.amt_receive.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 whitespace-nowrap">
                    <tr>
                      <th className="px-2 py-2 text-right">Seq.</th>
                      <th className="px-2 py-2 text-left">Date/Time</th>
                      <th className="px-2 py-2 text-left">Receipt NO.</th>
                      <th className="px-2 py-2 text-left">ID.</th>
                      <th className="px-2 py-2 text-left">Name</th>
                      <th className="px-2 py-2 text-right">Amt. Receive</th>
                      <th className="px-2 py-2 text-right">Amt. Change</th>
                      <th className="px-2 py-2 text-right">Amt. Billing</th>
                      <th className="px-2 py-2 text-right">Amt. Cash</th>
                      <th className="px-2 py-2 text-right">Amt. Campus card</th>
                      <th className="px-2 py-2 text-right">Amt. Credit card</th>
                      <th className="px-2 py-2 text-right">Amt. QR Code</th>
                      <th className="px-2 py-2 text-right">Amt. Department</th>
                      <th className="px-2 py-2 text-left">Remark</th>
                      <th className="px-2 py-2 text-left">Bundle</th>
                      <th className="px-2 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ssData.rows.length === 0 ? (
                      <tr>
                        <td colSpan={16} className="px-3 py-4 text-center text-muted-foreground">
                          No receipts match these filters.
                        </td>
                      </tr>
                    ) : (
                      ssData.rows.map((r) => (
                        <tr key={r.seq} className={cn("border-t", r.status !== "ACTIVE" && "opacity-60")}>
                          <td className="px-2 py-1.5 text-right font-mono">{r.seq}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">{r.transaction_date.slice(0, 19).replace("T", " ")}</td>
                          <td className="px-2 py-1.5 font-mono">{r.receipt_number}</td>
                          <td className="px-2 py-1.5 font-mono">{r.customer_id ?? "—"}</td>
                          <td className="px-2 py-1.5">{r.customer_name ?? "—"}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.amt_receive.toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.amt_change > 0 ? r.amt_change.toFixed(2) : ""}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.amt_billing > 0 ? r.amt_billing.toFixed(2) : ""}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.amt_cash > 0 ? r.amt_cash.toFixed(2) : ""}</td>
                          <td className="px-2 py-1.5 text-right font-mono">
                            {r.amt_campus_card > 0
                              ? (r.status === "ACTIVE" ? r.amt_campus_card : -r.amt_campus_card).toFixed(2)
                              : ""}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.amt_credit_card > 0 ? r.amt_credit_card.toFixed(2) : ""}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.amt_qr_code > 0 ? r.amt_qr_code.toFixed(2) : ""}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.amt_other > 0 ? r.amt_other.toFixed(2) : ""}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{r.remark ?? ""}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{r.bundle_names ?? ""}</td>
                          <td className="px-2 py-1.5">
                            <span className="text-muted-foreground">Active</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {ssData.rows.length > 0 && (
                    <tfoot className="bg-muted/30 font-semibold whitespace-nowrap">
                      <tr className="border-t">
                        <td colSpan={5} className="px-2 py-2 text-left">TOTAL</td>
                        <td className="px-2 py-2 text-right font-mono">{ssData.totals.amt_receive.toFixed(2)}</td>
                        <td className="px-2 py-2 text-right font-mono">{ssData.totals.amt_change.toFixed(2)}</td>
                        <td className="px-2 py-2 text-right font-mono">{ssData.totals.amt_billing.toFixed(2)}</td>
                        <td className="px-2 py-2 text-right font-mono">{ssData.totals.amt_cash.toFixed(2)}</td>
                        <td className="px-2 py-2 text-right font-mono">{ssData.totals.amt_campus_card.toFixed(2)}</td>
                        <td className="px-2 py-2 text-right font-mono">{ssData.totals.amt_credit_card.toFixed(2)}</td>
                        <td className="px-2 py-2 text-right font-mono">{ssData.totals.amt_qr_code.toFixed(2)}</td>
                        <td className="px-2 py-2 text-right font-mono">{ssData.totals.amt_other.toFixed(2)}</td>
                        <td />
                        <td />
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
