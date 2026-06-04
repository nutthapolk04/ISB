import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, FileDown, ArrowLeftRight, Loader2, Package, TrendingUp, CreditCard, ClipboardList, FileSpreadsheet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoCallout } from "@/components/InfoCallout";
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
  type ReportColumn,
  type ReportPayload,
} from "@/lib/reportExport";

interface CanteenShop { id: string; name: string; }

interface SalesRow { product_name: string; quantity: number; total: number; }
interface SalesReportData { rows: SalesRow[]; grand_total: number; receipt_count: number; }

interface StockRow { product_code: string | null; product_name: string; stock_qty: number; shop_id: string; shop_name: string | null; }
interface StockReportData { rows: StockRow[]; }

interface ReturnRow {
  id: number; return_date: string; receipt_number: string;
  product_name: string; quantity: number;
  refund_amount: number; exchange_amount: number; status: string;
}
interface ReturnReportData { rows: ReturnRow[]; total_refund: number; total_exchange: number; }

interface SalesByPaymentRow { payment_method: string; receipt_count: number; total: number; }
interface SalesByPaymentReportData {
  rows: SalesByPaymentRow[];
  grand_total: number;
  total_receipts: number;
  retail_total: number;
  department_total: number;
  department_receipts: number;
}

interface StockCardRow {
  date: string;
  movement_type: string;
  quantity: number;
  reference: string | null;
  notes: string | null;
  running_balance: number;
}
interface StockCardReportData {
  product_variant_id: number;
  product_name: string;
  sku: string;
  date_from: string;
  date_to: string;
  opening_balance: number;
  rows: StockCardRow[];
  closing_balance: number;
}

// ── Sales Summary ──────────────────────────────────────────────────────────
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

// ── Sales by Item ──────────────────────────────────────────────────────────
interface SalesByItemRow {
  seq: number;
  transaction_date: string;
  item_no: string | null;
  item_name: string;
  receipt_number: string;
  customer_id: string | null;
  customer_name: string | null;
  sales_qty: number;
  sales_amt: number;
  receive_type: string;
  remark: string | null;
}

interface SalesByItemTotals {
  sales_qty: number;
  sales_amt: number;
}

interface SalesByItemReportData {
  date_from: string | null;
  date_to: string | null;
  shop_id: string | null;
  rows: SalesByItemRow[];
  totals: SalesByItemTotals;
  line_count: number;
}

const REPORT_DEFS: { type: string; icon: typeof FileText; needsRange: boolean }[] = [
  { type: "salesReport",          icon: FileText,        needsRange: true  },
  { type: "topSellingReport",     icon: TrendingUp,      needsRange: true  },
  { type: "salesByPaymentReport", icon: CreditCard,      needsRange: true  },
  { type: "stockReport",          icon: Package,         needsRange: false },
  { type: "returnReport",         icon: ArrowLeftRight,  needsRange: true  },
  { type: "stockCardReport",      icon: ClipboardList,   needsRange: true  },
  // Sales Summary and Sales by Item use their own inline panels (like
  // stockCardReport) — they don't need the legacy date-range dialog.
  { type: "salesSummaryReport",   icon: FileText,        needsRange: false },
  { type: "salesByItemReport",    icon: Package,         needsRange: false },
];

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

const BOM = String.fromCharCode(0xfeff);

function downloadCsv(name: string, content: string) {
  const blob = new Blob([BOM + content], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", name);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const csvEscape = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes("\n") || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

const Reports = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const school = useSchoolInfo();
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [selectedReportType, setSelectedReportType] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [exporting, setExporting] = useState(false);

  // Canteen area manager: null shopId but shopModule=canteen → show stall selector
  const isCanteenAreaMgr = user?.shopModule === "canteen" && !user?.shopId && user?.role !== "admin";
  const [canteenStalls, setCanteenStalls] = useState<CanteenShop[]>([]);
  const [selectedStall, setSelectedStall] = useState<string>("all");

  useEffect(() => {
    if (!isCanteenAreaMgr) return;
    api.get<CanteenShop[]>("/shops?module=canteen").then(setCanteenStalls).catch(() => {});
  }, [isCanteenAreaMgr]);

  // Stock Card state
  const [stockCardVariantId, setStockCardVariantId] = useState("");
  const [stockCardFrom, setStockCardFrom] = useState("");
  const [stockCardTo, setStockCardTo] = useState("");
  const [stockCardLoading, setStockCardLoading] = useState(false);
  const [stockCardData, setStockCardData] = useState<StockCardReportData | null>(null);

  // ── Sales Summary state ─────────────────────────────────────────────────
  // Every filter is optional. Strings start empty (untouched), dropdown
  // selects default to "all".
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

  // ── Sales by Item state ─────────────────────────────────────────────────
  const [siDateFrom, setSiDateFrom] = useState("");
  const [siDateTo, setSiDateTo] = useState("");
  const [siUserName, setSiUserName] = useState("");
  const [siCategoryCode, setSiCategoryCode] = useState("");
  const [siItemNoFrom, setSiItemNoFrom] = useState("");
  const [siItemNoTo, setSiItemNoTo] = useState("");
  const [siLoading, setSiLoading] = useState(false);
  const [siData, setSiData] = useState<SalesByItemReportData | null>(null);

  const currentDef = REPORT_DEFS.find((d) => d.type === selectedReportType);
  const needsRange = currentDef?.needsRange ?? true;

  const handleReportClick = (reportType: string) => {
    if (reportType === "stockCardReport") {
      setSelectedReportType(reportType);
      setStockCardData(null);
      return;
    }
    if (reportType === "salesSummaryReport") {
      setSelectedReportType(reportType);
      setSsData(null);
      return;
    }
    if (reportType === "salesByItemReport") {
      setSelectedReportType(reportType);
      setSiData(null);
      return;
    }
    setSelectedReportType(reportType);
    setStartDate("");
    setEndDate("");
    setSelectedStall("all");
    setIsDatePickerOpen(true);
  };

  const handleLoadStockCard = async () => {
    if (!stockCardVariantId || !stockCardFrom || !stockCardTo) {
      toast.error(t("reports.stockCard.fillAll"));
      return;
    }
    setStockCardLoading(true);
    try {
      const data = await api.get<StockCardReportData>(
        `/reports/stock-card?product_variant_id=${encodeURIComponent(stockCardVariantId)}&date_from=${stockCardFrom}&date_to=${stockCardTo}`,
      );
      setStockCardData(data);
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric");
      toast.error(detail);
    } finally {
      setStockCardLoading(false);
    }
  };

  /**
   * Build the shared ReportPayload for Stockcard. Used by both PDF and Excel
   * exporters so the two outputs stay structurally identical.
   */
  const buildStockCardPayload = (): ReportPayload<Record<string, unknown>> | null => {
    if (!stockCardData) return null;
    const { product_name, sku, date_from, date_to, opening_balance, rows, closing_balance } = stockCardData;

    const columns: ReportColumn[] = [
      { header: "Date", key: "date", format: "datetime", width: 130 },
      { header: "Type", key: "movement_type", width: 80 },
      { header: "Quantity", key: "quantity", format: "number", width: 70 },
      { header: "Running Balance", key: "running_balance", format: "number", width: 90 },
      { header: "Reference", key: "reference" },
      { header: "Notes", key: "notes" },
    ];

    // Pre-format quantity with explicit sign so users can tell incoming vs
    // outgoing movements at a glance, just like the on-screen table.
    const body = rows.map((r) => ({
      date: r.date,
      movement_type: r.movement_type,
      quantity: r.quantity, // keep numeric so totals/sums work
      running_balance: r.running_balance,
      reference: r.reference ?? "",
      notes: r.notes ?? "",
    }));

    return {
      meta: {
        title: "Stock Card Report",
        schoolName: school.name,
        schoolLogoUrl: school.logoUrl || undefined,
        filters: [
          `Product: ${product_name}  (SKU: ${sku})`,
          `Date Range: ${date_from} → ${date_to}`,
          `Opening Balance: ${opening_balance}`,
        ],
      },
      columns,
      rows: body,
      totals: {
        date: "CLOSING BALANCE",
        running_balance: closing_balance,
      },
    };
  };

  const handleExportStockCardPdf = async () => {
    const payload = buildStockCardPayload();
    if (!payload || !stockCardData) return;
    try {
      const fname = `StockCard_${stockCardData.sku}_${stockCardData.date_from}_${stockCardData.date_to}.pdf`;
      await exportToPDF(payload, fname);
      toast.success(t("reports.exportSuccess"));
    } catch (err) {
      const detail = err instanceof Error ? err.message : t("shopUsers.errorGeneric");
      toast.error(detail);
    }
  };

  const handleExportStockCardExcel = () => {
    const payload = buildStockCardPayload();
    if (!payload || !stockCardData) return;
    try {
      const fname = `StockCard_${stockCardData.sku}_${stockCardData.date_from}_${stockCardData.date_to}.xlsx`;
      exportToExcel(payload, fname);
      toast.success(t("reports.exportSuccess"));
    } catch (err) {
      const detail = err instanceof Error ? err.message : t("shopUsers.errorGeneric");
      toast.error(detail);
    }
  };

  // ── Sales Summary handlers ──────────────────────────────────────────────

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

    // Honour the canteen-area-manager stall selector when present, otherwise
    // fall back to the user's own shop scope (handled server-side).
    if (isCanteenAreaMgr) {
      if (selectedStall === "all") params.set("module", "canteen");
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
    if (isCanteenAreaMgr && selectedStall !== "all") {
      const stall = canteenStalls.find((s) => s.id === selectedStall);
      if (stall) lines.push(`Shop: ${stall.name}`);
    }
    return lines;
  };

  const buildSalesSummaryPayload = (): ReportPayload<Record<string, unknown>> | null => {
    if (!ssData) return null;
    const columns: ReportColumn[] = [
      { header: "Seq",             key: "seq",             format: "number",   align: "right", width: 36  },
      { header: "Date/Time",       key: "transaction_date", format: "datetime", width: 110 },
      { header: "Receipt NO.",     key: "receipt_number",  width: 90  },
      { header: "ID",              key: "customer_id",     width: 70  },
      { header: "Name",            key: "customer_name",   width: 130 },
      { header: "Amt.Receive",     key: "amt_receive",     format: "currency" },
      { header: "Amt.Change",      key: "amt_change",      format: "currency" },
      { header: "Amt.Billing",     key: "amt_billing",     format: "currency" },
      { header: "Amt.Cash",        key: "amt_cash",        format: "currency" },
      { header: "Amt.Campus card", key: "amt_campus_card", format: "currency" },
      { header: "Amt.Credit card", key: "amt_credit_card", format: "currency" },
      { header: "Amt.QR Code",     key: "amt_qr_code",     format: "currency" },
      { header: "Amt.Other",       key: "amt_other",       format: "currency" },
      { header: "Remark",          key: "remark",          width: 120 },
    ];

    return {
      meta: {
        title: "Sales Summary Report",
        schoolName: school.name,
        schoolLogoUrl: school.logoUrl || undefined,
        filters: buildSalesSummaryFilterLines(),
      },
      columns,
      rows: ssData.rows as unknown as Record<string, unknown>[],
      totals: {
        seq: "TOTAL",
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
      const fname = `SalesSummary_${ssDateFrom || "any"}_${ssDateTo || "any"}.pdf`;
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
      const fname = `SalesSummary_${ssDateFrom || "any"}_${ssDateTo || "any"}.xlsx`;
      exportToExcel(payload, fname);
      toast.success(t("reports.exportSuccess"));
    } catch (err) {
      const detail = err instanceof Error ? err.message : t("shopUsers.errorGeneric");
      toast.error(detail);
    }
  };

  // ── Sales by Item handlers ──────────────────────────────────────────────

  const buildSalesByItemQuery = (): string => {
    const params = new URLSearchParams();
    if (siDateFrom) params.set("date_from", siDateFrom);
    if (siDateTo) params.set("date_to", siDateTo);
    if (siUserName.trim()) params.set("user_name", siUserName.trim());
    if (siCategoryCode.trim()) params.set("category_code", siCategoryCode.trim());
    if (siItemNoFrom.trim()) params.set("item_no_from", siItemNoFrom.trim());
    if (siItemNoTo.trim()) params.set("item_no_to", siItemNoTo.trim());
    if (isCanteenAreaMgr) {
      if (selectedStall === "all") params.set("module", "canteen");
      else params.set("shop_id", selectedStall);
    } else if (user?.shopId) {
      params.set("shop_id", user.shopId);
    }
    return params.toString();
  };

  const handleLoadSalesByItem = async () => {
    setSiLoading(true);
    try {
      const qs = buildSalesByItemQuery();
      const data = await api.get<SalesByItemReportData>(
        `/reports/sales-by-item${qs ? `?${qs}` : ""}`,
      );
      setSiData(data);
      if (data.rows.length === 0) toast.message("No line items match these filters.");
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric");
      toast.error(detail);
    } finally {
      setSiLoading(false);
    }
  };

  const buildSalesByItemFilterLines = (): string[] => {
    const lines: string[] = [];
    const dateLine = buildDateFilterLine("Date", siDateFrom, siDateTo);
    if (dateLine) lines.push(dateLine);
    if (siUserName.trim()) lines.push(`Name: ${siUserName.trim()}`);
    if (siCategoryCode.trim()) lines.push(`Category: ${siCategoryCode.trim()}`);
    if (siItemNoFrom.trim() || siItemNoTo.trim()) {
      lines.push(`Item NO: ${siItemNoFrom.trim() || "—"} → ${siItemNoTo.trim() || "—"}`);
    }
    if (isCanteenAreaMgr && selectedStall !== "all") {
      const stall = canteenStalls.find((s) => s.id === selectedStall);
      if (stall) lines.push(`Shop: ${stall.name}`);
    }
    return lines;
  };

  const buildSalesByItemPayload = (): ReportPayload<Record<string, unknown>> | null => {
    if (!siData) return null;
    const columns: ReportColumn[] = [
      { header: "Seq",          key: "seq",              format: "number",   align: "right", width: 36  },
      { header: "Date/Time",    key: "transaction_date", format: "datetime", width: 110 },
      { header: "Item NO.",     key: "item_no",          width: 80  },
      { header: "Item Name",    key: "item_name",        width: 140 },
      { header: "Receipt NO.",  key: "receipt_number",   width: 90  },
      { header: "ID",           key: "customer_id",      width: 70  },
      { header: "Name",         key: "customer_name",    width: 110 },
      { header: "Sales Qty",    key: "sales_qty",        format: "number"   },
      { header: "Sales AMT",    key: "sales_amt",        format: "currency" },
      { header: "Receive Type", key: "receive_type",     width: 80  },
      { header: "Remark",       key: "remark",           width: 110 },
    ];
    return {
      meta: {
        title: "Sales by Item Report",
        schoolName: school.name,
        schoolLogoUrl: school.logoUrl || undefined,
        filters: buildSalesByItemFilterLines(),
      },
      columns,
      rows: siData.rows as unknown as Record<string, unknown>[],
      totals: {
        seq: "TOTAL By Item",
        sales_qty: siData.totals.sales_qty,
        sales_amt: siData.totals.sales_amt,
      },
    };
  };

  const handleExportSalesByItemPdf = async () => {
    const payload = buildSalesByItemPayload();
    if (!payload || !siData) return;
    try {
      const fname = `SalesByItem_${siDateFrom || "any"}_${siDateTo || "any"}.pdf`;
      await exportToPDF(payload, fname);
      toast.success(t("reports.exportSuccess"));
    } catch (err) {
      const detail = err instanceof Error ? err.message : t("shopUsers.errorGeneric");
      toast.error(detail);
    }
  };

  const handleExportSalesByItemExcel = () => {
    const payload = buildSalesByItemPayload();
    if (!payload || !siData) return;
    try {
      const fname = `SalesByItem_${siDateFrom || "any"}_${siDateTo || "any"}.xlsx`;
      exportToExcel(payload, fname);
      toast.success(t("reports.exportSuccess"));
    } catch (err) {
      const detail = err instanceof Error ? err.message : t("shopUsers.errorGeneric");
      toast.error(detail);
    }
  };

  // Build scope query param
  const shopParam = (() => {
    if (user?.role === "admin") return "";
    if (isCanteenAreaMgr) {
      return selectedStall === "all"
        ? "&module=canteen"
        : `&shop_id=${encodeURIComponent(selectedStall)}`;
    }
    return user?.shopId ? `&shop_id=${encodeURIComponent(user.shopId)}` : "";
  })();

  const handleExportExcel = async () => {
    if (needsRange && (!startDate || !endDate)) {
      toast.error(t("reports.selectDateRangeDesc"));
      return;
    }

    const reportName = t(`reports.${selectedReportType}`);
    setExporting(true);
    try {
      let csv = `${reportName}\n`;
      if (needsRange) {
        csv += `${t("reports.startDate")}: ${startDate}\n${t("reports.endDate")}: ${endDate}\n\n`;
      } else {
        csv += `\n`;
      }

      if (selectedReportType === "salesReport" || selectedReportType === "topSellingReport") {
        const data = await api.get<SalesReportData>(
          `/reports/sales?date_from=${startDate}&date_to=${endDate}${shopParam}`,
        );
        const rows = selectedReportType === "topSellingReport"
          ? [...data.rows].sort((a, b) => b.quantity - a.quantity)
          : data.rows;
        csv += `${t("reports.colProduct")},${t("reports.colQuantity")},${t("reports.colTotal")}\n`;
        for (const r of rows) {
          csv += `${csvEscape(r.product_name)},${r.quantity},${r.total.toFixed(2)}\n`;
        }
        csv += `\n${t("reports.grandTotal")},,${data.grand_total.toFixed(2)}\n`;
        csv += `${t("reports.receiptCount")},${data.receipt_count},\n`;
      } else if (selectedReportType === "salesByPaymentReport") {
        const data = await api.get<SalesByPaymentReportData>(
          `/reports/sales-by-payment?date_from=${startDate}&date_to=${endDate}${shopParam}`,
        );
        csv += `${t("reports.colPaymentMethod") || "Payment Method"},${t("reports.colReceiptCount") || "Receipt Count"},${t("reports.colTotal")}\n`;
        for (const r of data.rows) {
          if (r.payment_method.toUpperCase() === "DEPARTMENT") continue;
          const methodLabel = t(`payment.${r.payment_method}`) || r.payment_method;
          csv += `${csvEscape(methodLabel)},${r.receipt_count},${r.total.toFixed(2)}\n`;
        }
        csv += `\n${t("reports.grandTotal")},,${data.retail_total.toFixed(2)}\n`;
        csv += `${t("reports.totalReceipts") || "Total Receipts"},${data.total_receipts - data.department_receipts},\n`;
        csv += `\n${t("reports.deptUseHeader", "Department Use (Internal)")},,\n`;
        csv += `Department Use,${data.department_receipts},${data.department_total.toFixed(2)}\n`;
      } else if (selectedReportType === "stockReport") {
        const stockShopParam = shopParam.replace(/^&/, "?");
        const data = await api.get<StockReportData>(`/reports/stock${stockShopParam}`);
        csv += `${t("reports.colShop")},${t("reports.colProductCode")},${t("reports.colProduct")},${t("reports.colStock")}\n`;
        for (const r of data.rows) {
          csv += `${csvEscape(r.shop_name ?? r.shop_id)},${csvEscape(r.product_code)},${csvEscape(r.product_name)},${r.stock_qty}\n`;
        }
      } else if (selectedReportType === "returnReport") {
        const data = await api.get<ReturnReportData>(
          `/reports/returns?date_from=${startDate}&date_to=${endDate}${shopParam}`,
        );
        csv += `${t("reports.colId")},${t("reports.colDate")},${t("reports.colReceipt")},${t("reports.colProduct")},${t("reports.colQuantity")},${t("reports.colRefund")},${t("reports.colExchange")},${t("reports.colStatus")}\n`;
        for (const r of data.rows) {
          csv += `${r.id},${r.return_date.slice(0, 10)},${csvEscape(r.receipt_number)},${csvEscape(r.product_name)},${r.quantity},${r.refund_amount.toFixed(2)},${r.exchange_amount.toFixed(2)},${csvEscape(r.status)}\n`;
        }
        csv += `\n${t("reports.totalRefund")},,,,,${data.total_refund.toFixed(2)},,\n`;
        csv += `${t("reports.totalExchange")},,,,,,${data.total_exchange.toFixed(2)},\n`;
      } else {
        toast.message(t("reports.comingSoon"));
        setExporting(false);
        return;
      }

      const dateLabel = needsRange ? `_${startDate}_${endDate}` : "";
      downloadCsv(`${reportName}${dateLabel}.csv`, csv);
      toast.success(t("reports.exportSuccess"));
      setIsDatePickerOpen(false);
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric");
      toast.error(detail);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title mb-2">{t("reports.title")}</h1>
        <p className="page-description">{t("reports.description")}</p>
      </div>

      <InfoCallout
        id="reports.exportFormat"
        variant="info"
        title={t("reports.info.exportFormat.title")}
      >
        {t("reports.info.exportFormat.body")}
      </InfoCallout>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {REPORT_DEFS.map(({ type, icon: Icon }) => (
          <Card
            key={type}
            className="interactive-card"
            onClick={() => handleReportClick(type)}
          >
            <CardHeader>
              <CardTitle className="flex items-center">
                <Icon className="h-5 w-5 mr-2 text-primary" />
                {t(`reports.${type}`)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t(`reports.${type}Desc`)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Stock Card inline panel */}
      {selectedReportType === "stockCardReport" && (
        <div className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-primary" />
                {t("reports.stockCardReport")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="scVariantId">{t("reports.stockCard.variantId")}</Label>
                  <Input
                    id="scVariantId"
                    type="number"
                    min={1}
                    placeholder="1"
                    value={stockCardVariantId}
                    onChange={(e) => setStockCardVariantId(e.target.value)}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>{t("reports.startDate")} — {t("reports.endDate")}</Label>
                  <DateRangePicker
                    id="scDateRange"
                    startDate={stockCardFrom}
                    endDate={stockCardTo}
                    onStartChange={setStockCardFrom}
                    onEndChange={setStockCardTo}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleLoadStockCard} disabled={stockCardLoading}>
                  {stockCardLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  {t("reports.stockCard.load")}
                </Button>
                {stockCardData && (
                  <>
                    <Button variant="outline" onClick={handleExportStockCardPdf}>
                      <FileText className="h-4 w-4 mr-2" />
                      Export PDF
                    </Button>
                    <Button variant="outline" onClick={handleExportStockCardExcel}>
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                      Export Excel
                    </Button>
                  </>
                )}
              </div>

              {stockCardData && (
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium">{stockCardData.product_name}</span>
                    {" · SKU: "}{stockCardData.sku}
                  </div>
                  <div className="rounded-md border p-3 bg-secondary/50 text-sm flex justify-between">
                    <span>{t("reports.stockCard.openingBalance")}</span>
                    <span className="font-semibold">{stockCardData.opening_balance}</span>
                  </div>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left">{t("reports.colDate")}</th>
                          <th className="px-3 py-2 text-left">{t("reports.stockCard.colType")}</th>
                          <th className="px-3 py-2 text-right">{t("reports.colQuantity")}</th>
                          <th className="px-3 py-2 text-right">{t("reports.stockCard.colRunning")}</th>
                          <th className="px-3 py-2 text-left">{t("reports.stockCard.colReference")}</th>
                          <th className="px-3 py-2 text-left">{t("reports.stockCard.colNotes")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockCardData.rows.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                              {t("reports.stockCard.noMovements")}
                            </td>
                          </tr>
                        ) : (
                          stockCardData.rows.map((row, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-3 py-2 whitespace-nowrap">{row.date.slice(0, 19).replace("T", " ")}</td>
                              <td className="px-3 py-2">{row.movement_type}</td>
                              <td className={`px-3 py-2 text-right font-mono ${row.quantity >= 0 ? "text-green-600" : "text-red-600"}`}>
                                {row.quantity >= 0 ? "+" : ""}{row.quantity}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">{row.running_balance}</td>
                              <td className="px-3 py-2">{row.reference ?? "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground">{row.notes ?? ""}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-md border p-3 bg-primary/5 text-sm flex justify-between font-medium">
                    <span>{t("reports.stockCard.closingBalance")}</span>
                    <span className="font-semibold">{stockCardData.closing_balance}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sales Summary inline panel — every filter optional, leave blank to
          query the full dataset visible to this user. */}
      {selectedReportType === "salesSummaryReport" && (
        <div className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Sales Summary Report
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
                    placeholder="Search name (customer or payer)"
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

                {isCanteenAreaMgr && (
                  <div className="space-y-2">
                    <Label htmlFor="ssShop">Shop</Label>
                    <Select value={selectedStall} onValueChange={setSelectedStall}>
                      <SelectTrigger id="ssShop"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All canteen stalls</SelectItem>
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
                          <th className="px-2 py-2 text-right">Seq</th>
                          <th className="px-2 py-2 text-left">Date/Time</th>
                          <th className="px-2 py-2 text-left">Receipt NO.</th>
                          <th className="px-2 py-2 text-left">ID</th>
                          <th className="px-2 py-2 text-left">Name</th>
                          <th className="px-2 py-2 text-right">Receive</th>
                          <th className="px-2 py-2 text-right">Change</th>
                          <th className="px-2 py-2 text-right">Billing</th>
                          <th className="px-2 py-2 text-right">Cash</th>
                          <th className="px-2 py-2 text-right">Campus</th>
                          <th className="px-2 py-2 text-right">Credit</th>
                          <th className="px-2 py-2 text-right">QR</th>
                          <th className="px-2 py-2 text-right">Other</th>
                          <th className="px-2 py-2 text-left">Remark</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ssData.rows.length === 0 ? (
                          <tr>
                            <td colSpan={14} className="px-3 py-4 text-center text-muted-foreground">
                              No receipts match these filters.
                            </td>
                          </tr>
                        ) : (
                          ssData.rows.map((r) => (
                            <tr key={r.seq} className="border-t">
                              <td className="px-2 py-1.5 text-right font-mono">{r.seq}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap">{r.transaction_date.slice(0, 19).replace("T", " ")}</td>
                              <td className="px-2 py-1.5 font-mono">{r.receipt_number}</td>
                              <td className="px-2 py-1.5 font-mono">{r.customer_id ?? "—"}</td>
                              <td className="px-2 py-1.5">{r.customer_name ?? "—"}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{r.amt_receive.toFixed(2)}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{r.amt_change > 0 ? r.amt_change.toFixed(2) : ""}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{r.amt_billing > 0 ? r.amt_billing.toFixed(2) : ""}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{r.amt_cash > 0 ? r.amt_cash.toFixed(2) : ""}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{r.amt_campus_card > 0 ? r.amt_campus_card.toFixed(2) : ""}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{r.amt_credit_card > 0 ? r.amt_credit_card.toFixed(2) : ""}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{r.amt_qr_code > 0 ? r.amt_qr_code.toFixed(2) : ""}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{r.amt_other > 0 ? r.amt_other.toFixed(2) : ""}</td>
                              <td className="px-2 py-1.5 text-muted-foreground">{r.remark ?? ""}</td>
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
      )}

      {/* Sales by Item inline panel — every filter optional. */}
      {selectedReportType === "salesByItemReport" && (
        <div className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5 text-primary" />
                Sales by Item Report
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                All filters are optional. Leave any field blank to skip that filter.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2 md:col-span-2 lg:col-span-3">
                  <Label>Date Range</Label>
                  <DateRangePicker
                    id="siDateRange"
                    startDate={siDateFrom}
                    endDate={siDateTo}
                    onStartChange={setSiDateFrom}
                    onEndChange={setSiDateTo}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="siUserName">User Name</Label>
                  <Input id="siUserName" placeholder="Search name (customer or payer)"
                    value={siUserName} onChange={(e) => setSiUserName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="siCategoryCode">Category Code</Label>
                  <Input id="siCategoryCode" placeholder="Exact category match"
                    value={siCategoryCode} onChange={(e) => setSiCategoryCode(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="siItemNoFrom">Item NO. From</Label>
                  <Input id="siItemNoFrom" placeholder="SKU lower bound"
                    value={siItemNoFrom} onChange={(e) => setSiItemNoFrom(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="siItemNoTo">Item NO. To</Label>
                  <Input id="siItemNoTo" placeholder="SKU upper bound"
                    value={siItemNoTo} onChange={(e) => setSiItemNoTo(e.target.value)} />
                </div>
                {isCanteenAreaMgr && (
                  <div className="space-y-2">
                    <Label htmlFor="siShop">Shop</Label>
                    <Select value={selectedStall} onValueChange={setSelectedStall}>
                      <SelectTrigger id="siShop"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All canteen stalls</SelectItem>
                        {canteenStalls.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleLoadSalesByItem} disabled={siLoading}>
                  {siLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Search
                </Button>
                {siData && (
                  <>
                    <Button variant="outline" onClick={handleExportSalesByItemPdf}>
                      <FileText className="h-4 w-4 mr-2" />
                      Export PDF
                    </Button>
                    <Button variant="outline" onClick={handleExportSalesByItemExcel}>
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                      Export Excel
                    </Button>
                  </>
                )}
              </div>

              {siData && (
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    Found <span className="font-semibold text-foreground">{siData.line_count}</span> line items
                    {" · "}Total Qty{" "}
                    <span className="font-semibold text-foreground">{siData.totals.sales_qty}</span>
                    {" · "}Total Amount{" "}
                    <span className="font-semibold text-foreground">
                      ฿{siData.totals.sales_amt.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 whitespace-nowrap">
                        <tr>
                          <th className="px-2 py-2 text-right">Seq</th>
                          <th className="px-2 py-2 text-left">Date/Time</th>
                          <th className="px-2 py-2 text-left">Item NO.</th>
                          <th className="px-2 py-2 text-left">Item Name</th>
                          <th className="px-2 py-2 text-left">Receipt NO.</th>
                          <th className="px-2 py-2 text-left">ID</th>
                          <th className="px-2 py-2 text-left">Name</th>
                          <th className="px-2 py-2 text-right">Sales Qty</th>
                          <th className="px-2 py-2 text-right">Sales AMT</th>
                          <th className="px-2 py-2 text-left">Receive Type</th>
                          <th className="px-2 py-2 text-left">Remark</th>
                        </tr>
                      </thead>
                      <tbody>
                        {siData.rows.length === 0 ? (
                          <tr>
                            <td colSpan={11} className="px-3 py-4 text-center text-muted-foreground">
                              No line items match these filters.
                            </td>
                          </tr>
                        ) : (
                          siData.rows.map((r) => (
                            <tr key={r.seq} className="border-t">
                              <td className="px-2 py-1.5 text-right font-mono">{r.seq}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap">{r.transaction_date.slice(0, 19).replace("T", " ")}</td>
                              <td className="px-2 py-1.5 font-mono">{r.item_no ?? "—"}</td>
                              <td className="px-2 py-1.5">{r.item_name}</td>
                              <td className="px-2 py-1.5 font-mono">{r.receipt_number}</td>
                              <td className="px-2 py-1.5 font-mono">{r.customer_id ?? "—"}</td>
                              <td className="px-2 py-1.5">{r.customer_name ?? "—"}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{r.sales_qty}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{r.sales_amt.toFixed(2)}</td>
                              <td className="px-2 py-1.5">{r.receive_type}</td>
                              <td className="px-2 py-1.5 text-muted-foreground">{r.remark ?? ""}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      {siData.rows.length > 0 && (
                        <tfoot className="bg-muted/30 font-semibold whitespace-nowrap">
                          <tr className="border-t">
                            <td colSpan={7} className="px-2 py-2 text-left">TOTAL By Item</td>
                            <td className="px-2 py-2 text-right font-mono">{siData.totals.sales_qty}</td>
                            <td className="px-2 py-2 text-right font-mono">{siData.totals.sales_amt.toFixed(2)}</td>
                            <td colSpan={2} />
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
      )}

      {/* Date Picker Dialog for Excel Export */}
      <Dialog open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileDown className="h-6 w-6 text-primary" />
              {needsRange ? t("reports.selectDateRange") : t("reports.exportExcel")}
            </DialogTitle>
            <DialogDescription>
              {needsRange ? t("reports.selectDateRangeDesc") : t("reports.stockReportDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {isCanteenAreaMgr && (
              <div className="space-y-2">
                <Label>{t("reports.canteenScope")}</Label>
                <Select value={selectedStall} onValueChange={setSelectedStall}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("reports.canteenScopeAll")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("reports.canteenScopeAll")}</SelectItem>
                    {canteenStalls.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {needsRange && (
              <div className="space-y-2">
                <Label htmlFor="dateRange">
                  {t("reports.startDate")} — {t("reports.endDate")}
                </Label>
                <DateRangePicker
                  id="dateRange"
                  startDate={startDate}
                  endDate={endDate}
                  onStartChange={setStartDate}
                  onEndChange={setEndDate}
                />
              </div>
            )}

            <div className="bg-secondary p-3 rounded-lg">
              <p className="text-sm font-medium">
                {selectedReportType && t(`reports.${selectedReportType}`)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedReportType && t(`reports.${selectedReportType}Desc`)}
              </p>
            </div>

            {selectedReportType === "salesByPaymentReport" && (
              <div className="border border-dashed border-muted-foreground/40 bg-muted/40 rounded-lg p-3 space-y-1">
                <p className="text-sm font-semibold text-muted-foreground">
                  Department Use (Internal)
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("reports.deptUseSeparated", "Department Use is tracked separately from normal sales.")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("reports.deptUseExcludedFromGrand", "Grand Total in this report covers normal sales only — Department Use is excluded.")}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDatePickerOpen(false)} disabled={exporting}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleExportExcel} disabled={exporting}>
              {exporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4 mr-2" />
              )}
              {t("reports.exportExcel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Reports;
