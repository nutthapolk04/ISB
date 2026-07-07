import React, { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
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
  SECTION_KEY,
  EMPHASIS_KEY,
  type ReportColumn,
  type ReportPayload,
} from "@/lib/reportExport";

interface CanteenShop { id: string; name: string; }

interface SalesRow {
  product_name: string;
  quantity: number;
  total: number;
  shop_id: string;
  shop_name: string | null;
}
interface SalesReportData { rows: SalesRow[]; grand_total: number; receipt_count: number; }

interface StockRow { product_code: string | null; product_name: string; stock_qty: number; shop_id: string; shop_name: string | null; }
interface StockReportData { rows: StockRow[]; }

interface ReturnRow {
  id: number; return_date: string; receipt_number: string;
  product_name: string; quantity: number;
  refund_amount: number; exchange_amount: number; status: string;
}
interface ReturnReportData { rows: ReturnRow[]; total_refund: number; total_exchange: number; }

interface SalesByPaymentRow {
  payment_method: string;
  receipt_count: number;
  total: number;
  shop_id: string;
  shop_name: string | null;
}
interface SalesByPaymentReportData {
  rows: SalesByPaymentRow[];
  grand_total: number;
  total_receipts: number;
  retail_total: number;
  department_total: number;
  department_receipts: number;
}

interface StockCardRow {
  date: string | null;
  description: string;
  invoice_no: string | null;
  qty_in: number;
  qty_out: number;
  qty_balance: number;
  amount_in: number;
  amount_out: number;
  cost_per_unit: number;
  amount_balance: number;
}
interface StockCardProductBlock {
  product_variant_id: number;
  product_code: string;
  product_name: string;
  rows: StockCardRow[];
  total_qty_in: number;
  total_qty_out: number;
  total_amount_in: number;
  total_amount_out: number;
}
interface StockCardReportData {
  shop_id: string | null;
  shop_name: string | null;
  date_from: string;
  date_to: string;
  products: StockCardProductBlock[];
}

interface ShopOption { id: string; name: string; }

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
  shop_id: string;
  shop_name: string | null;
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

// Reports that apply to BOTH modules (canteen + store).
const COMMON_REPORTS = [
  { type: "salesReport",          icon: FileText,        needsRange: true  },
  { type: "topSellingReport",     icon: TrendingUp,      needsRange: true  },
  { type: "salesByPaymentReport", icon: CreditCard,      needsRange: true  },
  { type: "salesSummaryReport",   icon: FileText,        needsRange: false },
  { type: "salesByItemReport",    icon: Package,         needsRange: false },
] satisfies { type: string; icon: typeof FileText; needsRange: boolean }[];

// Store-only reports — these don't make sense in a canteen context.
// Canteen has no returns (food can't be returned) and uses portion-based
// daily prep rather than SKU-level stock tracking, so per-SKU stock and
// stock-card reports belong to the store/coop module only.
const STORE_ONLY_REPORTS = [
  { type: "stockReport",     icon: Package,        needsRange: false },
  { type: "returnReport",    icon: ArrowLeftRight, needsRange: true  },
  { type: "stockCardReport", icon: ClipboardList,  needsRange: true  },
] satisfies { type: string; icon: typeof FileText; needsRange: boolean }[];

const REPORT_DEFS = [...COMMON_REPORTS, ...STORE_ONLY_REPORTS];

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

/**
 * Group rows by vendor for admin / multi-shop views. Returns the input rows
 * unchanged when only one shop appears (vendor user, or admin filtered to a
 * single shop) — the caller is then expected to surface the vendor name via
 * a "Shop: …" filter line instead. When multiple shops appear, inserts a
 * SECTION_KEY header row before each shop's rows and an EMPHASIS_KEY
 * "subtotal" row after, using `buildSubtotal` to fill the numeric columns.
 */
function buildVendorSections<T extends { shop_id: string; shop_name: string | null }>(
  rows: T[],
  buildSubtotal: (shopRows: T[]) => Record<string, unknown>,
): Record<string, unknown>[] {
  const uniqueShops = new Set(rows.map((r) => r.shop_id));
  if (uniqueShops.size <= 1) {
    return rows as unknown as Record<string, unknown>[];
  }

  const byShop = new Map<string, { name: string | null; rows: T[] }>();
  for (const r of rows) {
    const entry = byShop.get(r.shop_id);
    if (entry) entry.rows.push(r);
    else byShop.set(r.shop_id, { name: r.shop_name, rows: [r] });
  }

  const out: Record<string, unknown>[] = [];
  for (const [shopId, { name, rows: shopRows }] of byShop) {
    out.push({ [SECTION_KEY]: `Vendor: ${name ?? shopId}` });
    for (const r of shopRows) out.push(r as unknown as Record<string, unknown>);
    out.push({ [EMPHASIS_KEY]: "subtotal" as const, ...buildSubtotal(shopRows) });
  }
  return out;
}

/** True when the result spans more than one shop (admin / canteen-area-mgr "all"). */
function isMultiVendor<T extends { shop_id: string }>(rows: T[]): boolean {
  if (rows.length < 2) return false;
  const first = rows[0].shop_id;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].shop_id !== first) return true;
  }
  return false;
}


const Reports = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const school = useSchoolInfo();
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [selectedReportType, setSelectedReportType] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [exporting, setExporting] = useState(false);

  // Determine which module's Reports page we're rendering. /canteen/reports
  // narrows the visible cards to canteen-relevant ones; /store/reports and
  // /admin/reports get every report.
  const location = useLocation();
  const isCanteenReportsPage = location.pathname.startsWith("/canteen/");

  const REPORT_ID_MAP: Record<string, string> = isCanteenReportsPage
    ? {
        salesReport:          "ISB001",
        topSellingReport:     "ISB002",
        salesByPaymentReport: "ISB003",
        salesSummaryReport:   "ISB004",
        salesByItemReport:    "ISB005",
      }
    : {
        salesReport:          "ISB006",
        topSellingReport:     "ISB007",
        salesByPaymentReport: "ISB008",
        salesSummaryReport:   "ISB009",
        salesByItemReport:    "ISB010",
        stockReport:          "ISB011",
        returnReport:         "ISB012",
        stockCardReport:      "ISB013",
      };
  const visibleReports = useMemo(
    () => (isCanteenReportsPage ? COMMON_REPORTS : REPORT_DEFS),
    [isCanteenReportsPage],
  );

  // Shop selector visibility:
  //  - admin: pick any shop in the current module (canteen vs store)
  //  - canteen area manager (no shopId, shopModule=canteen): pick a canteen stall
  //  - other shop users: locked to their own shop (no selector)
  const isAdmin = user?.role === "admin";
  const isCanteenAreaMgr = user?.shopModule === "canteen" && !user?.shopId && !isAdmin;
  const needsShopSelector = isAdmin || isCanteenAreaMgr;
  const [canteenStalls, setCanteenStalls] = useState<CanteenShop[]>([]);
  const [selectedStall, setSelectedStall] = useState<string>("all");

  useEffect(() => {
    if (!needsShopSelector) return;
    const module = isCanteenReportsPage ? "canteen" : "store";
    api.get<CanteenShop[]>(`/shops?module=${module}`).then(setCanteenStalls).catch(() => {});
  }, [needsShopSelector, isCanteenReportsPage]);

  // Stock Card state. Multi-product mode requires shop_id; admins pick the
  // shop, single-shop users (manager/cashier) auto-use their own.
  const [stockCardShopId, setStockCardShopId] = useState<string>("");
  const [stockCardFrom, setStockCardFrom] = useState("");
  const [stockCardTo, setStockCardTo] = useState("");
  const [stockCardProductSearch, setStockCardProductSearch] = useState("");
  const [stockCardCategory, setStockCardCategory] = useState<string>("all");
  const [stockCardIncludeEmpty, setStockCardIncludeEmpty] = useState(false);
  const [stockCardLoading, setStockCardLoading] = useState(false);
  const [stockCardData, setStockCardData] = useState<StockCardReportData | null>(null);
  const [stockCardShops, setStockCardShops] = useState<ShopOption[]>([]);
  const [stockCardCategories, setStockCardCategories] = useState<string[]>([]);

  // Admin needs a shop dropdown — fetch when Stock Card panel is opened.
  useEffect(() => {
    if (selectedReportType !== "stockCardReport") return;
    if (!user) return;
    const module = isCanteenReportsPage ? "canteen" : "store";
    api.get<ShopOption[]>(`/shops?active_only=true&module=${module}`)
      .then(setStockCardShops)
      .catch((e) => console.error("[Reports] shop fetch failed:", e));
  }, [selectedReportType, user, isCanteenReportsPage]);

  // Fetch distinct category names for the current shop so the dropdown shows
  // only categories that actually have products. Resets when the shop
  // changes; admins switch shops, manager/cashier are pinned to theirs.
  useEffect(() => {
    const shopForCats = user?.role === "admin" ? stockCardShopId : user?.shopId ?? "";
    if (!shopForCats) {
      setStockCardCategories([]);
      setStockCardCategory("all");
      return;
    }
    api
      .get<{ category: string }[] | string[]>(`/shops/${shopForCats}/products?include_inactive=false`)
      .then((products) => {
        const names = new Set<string>();
        for (const p of products as Array<{ category?: string }>) {
          if (p?.category) names.add(p.category);
        }
        setStockCardCategories([...names].sort());
      })
      .catch(() => setStockCardCategories([]));
    setStockCardCategory("all");
  }, [stockCardShopId, user?.role, user?.shopId]);

  useEffect(() => {
    setStockCardData(null);
  }, [stockCardShopId]);

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
    // Resolve the effective shop_id: admins choose, others are locked to their
    // own shop. Backend will 400 if it ends up empty.
    const effectiveShopId = user?.role === "admin" ? stockCardShopId : (user?.shopId ?? "");
    if (!effectiveShopId || !stockCardFrom || !stockCardTo) {
      toast.error(t("reports.stockCard.fillAll"));
      return;
    }
    setStockCardLoading(true);
    setStockCardData(null);
    try {
      const params = new URLSearchParams({
        shop_id: effectiveShopId,
        date_from: stockCardFrom,
        date_to: stockCardTo,
      });
      const trimmedSearch = stockCardProductSearch.trim();
      if (trimmedSearch) params.set("product_search", trimmedSearch);
      if (stockCardCategory && stockCardCategory !== "all") {
        params.set("category", stockCardCategory);
      }
      if (stockCardIncludeEmpty) params.set("include_empty", "true");
      const data = await api.get<StockCardReportData>(
        `/reports/stock-card?${params.toString()}`,
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
   *
   * Layout mirrors the legacy MyCampusCard printed report: per-product
   * sections with a "Product Code … Name" header row, the Beginning Balance
   * row, every movement, the Closing Balance row, and a per-product TOTAL
   * row. All sections share the same column structure so the underlying
   * table renderer doesn't need to know about sections.
   */
  const buildStockCardPayload = (): ReportPayload<Record<string, unknown>> | null => {
    if (!stockCardData) return null;
    const { shop_name, date_from, date_to, products } = stockCardData;

    const columns: ReportColumn[] = [
      { header: "Date", key: "date", format: "date", width: 60 },
      { header: "Description", key: "description", width: 80 },
      { header: "Invoice No.", key: "invoice_no", width: 95 },
      { header: "Qty In", key: "qty_in", format: "number", width: 45 },
      { header: "Qty Out", key: "qty_out", format: "number", width: 45 },
      { header: "Qty Balance", key: "qty_balance", format: "number", width: 55 },
      { header: "Amt In", key: "amount_in", format: "currency", width: 60 },
      { header: "Amt Out", key: "amount_out", format: "currency", width: 60 },
      { header: "Cost/Unit", key: "cost_per_unit", format: "currency", width: 55 },
      { header: "Amt Balance", key: "amount_balance", format: "currency", width: 70 },
    ];

    const body: Record<string, unknown>[] = [];
    for (const block of products) {
      // Section header — uses the SECTION_KEY sentinel so the PDF/Excel
      // exporter merges the cell across every column (matching the legacy
      // MyCampusCard layout where the product label sits on its own row).
      body.push({
        [SECTION_KEY]: `Product Code: ${block.product_code} — ${block.product_name}`,
      });
      for (const r of block.rows) {
        // The "Closing Balance" row is the per-product running total — mark
        // it as a subtotal so the PDF gives it a tinted background and bold
        // text. "Beginning Balance" stays plain.
        const isClosing =
          typeof r.description === "string" &&
          r.description.toLowerCase().includes("closing");
        body.push({
          ...(isClosing ? { [EMPHASIS_KEY]: "subtotal" as const } : {}),
          date: r.date ?? "",
          description: r.description,
          invoice_no: r.invoice_no ?? "",
          qty_in: r.qty_in || "",
          qty_out: r.qty_out || "",
          qty_balance: r.qty_balance,
          amount_in: r.amount_in || "",
          amount_out: r.amount_out || "",
          cost_per_unit: r.cost_per_unit || "",
          amount_balance: r.amount_balance,
        });
      }
      // Per-product subtotal row — darker emphasis than Closing Balance so
      // the eye can tell them apart at a glance.
      body.push({
        [EMPHASIS_KEY]: "total" as const,
        date: "",
        description: "Total :",
        invoice_no: "",
        qty_in: block.total_qty_in,
        qty_out: block.total_qty_out,
        qty_balance: "",
        amount_in: block.total_amount_in,
        amount_out: block.total_amount_out,
        cost_per_unit: "",
        amount_balance: "",
      });
    }

    const filterLines: string[] = [
      `Shop: ${shop_name ?? stockCardData.shop_id ?? "-"}`,
    ];
    const trimmedSearch = stockCardProductSearch.trim();
    if (trimmedSearch) filterLines.push(`Search: ${trimmedSearch}`);
    if (stockCardCategory && stockCardCategory !== "all") {
      filterLines.push(`Category: ${stockCardCategory}`);
    }
    if (stockCardIncludeEmpty) filterLines.push("Includes empty products");
    filterLines.push(`User ID: ${user?.username ?? user?.fullName ?? "-"}`);
    filterLines.push(`Print Date: ${new Date().toLocaleString("en-GB")}`);

    return {
      meta: {
        title: `Stockcard Report From ${date_from} To ${date_to}`,
        schoolName: school.name,
        schoolLogoUrl: school.logoUrl || undefined,
        reportId: REPORT_ID_MAP["stockCardReport"],
        filters: filterLines,
      },
      columns,
      rows: body,
    };
  };

  const handleExportStockCardPdf = async () => {
    const payload = buildStockCardPayload();
    if (!payload || !stockCardData) return;
    try {
      const fname = `StockCard_${stockCardData.shop_id ?? "shop"}_${stockCardData.date_from}_${stockCardData.date_to}.pdf`;
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
      const fname = `StockCard_${stockCardData.shop_id ?? "shop"}_${stockCardData.date_from}_${stockCardData.date_to}.xlsx`;
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
      { header: "Amt. Other",       key: "amt_other",        format: "currency", width: 48 },
      { header: "Remark",           key: "remark",           width: 75  },
    ];

    const multi = isMultiVendor(ssData.rows);
    const filterLines = buildSalesSummaryFilterLines();
    let bodyRows: Record<string, unknown>[];
    if (multi) {
      bodyRows = buildVendorSections(ssData.rows, (shopRows) => ({
        customer_name: "Subtotal",
        amt_receive:      shopRows.reduce((s, r) => s + r.amt_receive,     0),
        amt_change:       shopRows.reduce((s, r) => s + r.amt_change,      0),
        amt_billing:      shopRows.reduce((s, r) => s + r.amt_billing,     0),
        amt_cash:         shopRows.reduce((s, r) => s + r.amt_cash,        0),
        amt_campus_card:  shopRows.reduce((s, r) => s + r.amt_campus_card, 0),
        amt_credit_card:  shopRows.reduce((s, r) => s + r.amt_credit_card, 0),
        amt_qr_code:      shopRows.reduce((s, r) => s + r.amt_qr_code,     0),
        amt_other:        shopRows.reduce((s, r) => s + r.amt_other,       0),
      }));
    } else {
      bodyRows = ssData.rows as unknown as Record<string, unknown>[];
      if (ssData.rows.length > 0) {
        filterLines.push(`Shop: ${ssData.rows[0].shop_name ?? ssData.rows[0].shop_id}`);
      }
    }

    return {
      meta: {
        title: "Sales Summary Report",
        schoolName: school.name,
        schoolLogoUrl: school.logoUrl || undefined,
        reportId: REPORT_ID_MAP["salesSummaryReport"],
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

  // ── Sales by Item handlers ──────────────────────────────────────────────

  const buildSalesByItemQuery = (): string => {
    const params = new URLSearchParams();
    if (siDateFrom) params.set("date_from", siDateFrom);
    if (siDateTo) params.set("date_to", siDateTo);
    if (siUserName.trim()) params.set("user_name", siUserName.trim());
    if (siCategoryCode.trim()) params.set("category_code", siCategoryCode.trim());
    if (siItemNoFrom.trim()) params.set("item_no_from", siItemNoFrom.trim());
    if (siItemNoTo.trim()) params.set("item_no_to", siItemNoTo.trim());
    if (needsShopSelector) {
      if (selectedStall === "all") params.set("module", isCanteenReportsPage ? "canteen" : "store");
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

      // Sort by best-selling item (highest total qty first) unless the filter
      // targets exactly one item code (from == to, both non-empty).
      const from = siItemNoFrom.trim();
      const to = siItemNoTo.trim();
      const isSingleItem = from !== "" && to !== "" && from.toLowerCase() === to.toLowerCase();
      if (!isSingleItem && data.rows.length > 0) {
        const qtyByItem = new Map<string, number>();
        for (const row of data.rows) {
          const key = row.item_no ?? "";
          qtyByItem.set(key, (qtyByItem.get(key) ?? 0) + row.sales_qty);
        }
        data.rows.sort((a, b) => {
          const qa = qtyByItem.get(a.item_no ?? "") ?? 0;
          const qb = qtyByItem.get(b.item_no ?? "") ?? 0;
          if (qb !== qa) return qb - qa;
          return b.transaction_date.localeCompare(a.transaction_date);
        });
        data.rows.forEach((r, i) => { r.seq = i + 1; });
      }

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
    if (needsShopSelector && selectedStall !== "all") {
      const stall = canteenStalls.find((s) => s.id === selectedStall);
      if (stall) lines.push(`Shop: ${stall.name}`);
    }
    return lines;
  };

  const buildSalesByItemPayload = (): ReportPayload<Record<string, unknown>> | null => {
    if (!siData) return null;
    // 11 columns — comfortable on A4 landscape at 7pt font. Total widths
    // ≈ 770pt (table budget). Header strings kept short to avoid the
    // vertical-stack wrapping bug seen at narrower defaults.
    const columns: ReportColumn[] = [
      { header: "Seq.",         key: "seq",              format: "number",   align: "right", width: 28  },
      { header: "Date/Time",  key: "transaction_date", format: "datetime", width: 95  },
      { header: "Item NO.",   key: "item_no",          width: 70  },
      { header: "Item Name",  key: "item_name",        width: 130 },
      { header: "Receipt NO.", key: "receipt_number",  width: 85  },
      { header: "ID.",         key: "customer_id",     width: 68  },
      { header: "Name",        key: "customer_name",   width: 77  },
      { header: "Sales Qty.",  key: "sales_qty",       format: "number",   align: "right", width: 42 },
      { header: "Sales AMT.",  key: "sales_amt",       format: "currency", align: "right", width: 60 },
      { header: "Receive Type", key: "receive_type",   width: 65  },
      { header: "Remark",      key: "remark",          width: 60  },
    ];
    return {
      meta: {
        title: "Sales by Item Report",
        schoolName: school.name,
        schoolLogoUrl: school.logoUrl || undefined,
        reportId: REPORT_ID_MAP["salesByItemReport"],
        filters: buildSalesByItemFilterLines(),
      },
      columns,
      rows: siData.rows as unknown as Record<string, unknown>[],
      totals: {
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
    if (needsShopSelector) {
      if (selectedStall === "all") {
        return `&module=${isCanteenReportsPage ? "canteen" : "store"}`;
      }
      return `&shop_id=${encodeURIComponent(selectedStall)}`;
    }
    return user?.shopId ? `&shop_id=${encodeURIComponent(user.shopId)}` : "";
  })();

  const buildDialogReportPayload = async (): Promise<{
    payload: ReportPayload<Record<string, unknown>>;
    baseFilename: string;
  } | null> => {
    if (needsRange && (!startDate || !endDate)) {
      toast.error(t("reports.selectDateRangeDesc"));
      return null;
    }

    const dateFilter = buildDateFilterLine("Date", startDate, endDate);
    const filters = dateFilter ? [dateFilter] : [];
    const dateLabel = needsRange ? `_${startDate}_${endDate}` : "";

    if (selectedReportType === "salesReport" || selectedReportType === "topSellingReport") {
      const data = await api.get<SalesReportData>(
        `/reports/sales?date_from=${startDate}&date_to=${endDate}${shopParam}`,
      );
      const isTopSelling = selectedReportType === "topSellingReport";
      const sortedRows = isTopSelling
        ? [...data.rows].sort((a, b) => b.quantity - a.quantity)
        : data.rows;

      // Group by vendor only for the plain Sales Report when the result spans
      // more than one shop. Top Selling is a single global ranking by design.
      const multi = !isTopSelling && isMultiVendor(sortedRows);
      const bodyRows = multi
        ? buildVendorSections(sortedRows, (shopRows) => ({
            product_name: "Subtotal",
            quantity: shopRows.reduce((s, r) => s + r.quantity, 0),
            total: shopRows.reduce((s, r) => s + r.total, 0),
          }))
        : (sortedRows as unknown as Record<string, unknown>[]);

      const reportFilters = [...filters];
      if (!multi && sortedRows.length > 0) {
        reportFilters.push(`Shop: ${sortedRows[0].shop_name ?? sortedRows[0].shop_id}`);
      }

      return {
        payload: {
          meta: {
            title: t(`reports.${selectedReportType}`),
            schoolName: school.name,
            schoolLogoUrl: school.logoUrl || undefined,
            reportId: REPORT_ID_MAP[selectedReportType],
            filters: reportFilters,
            runByName: user?.fullName ?? user?.username,
          },
          columns: [
            { header: t("reports.colProduct"),  key: "product_name", width: 45 },
            { header: t("reports.colQuantity"), key: "quantity",     format: "number",   align: "right", width: 12 },
            { header: t("reports.colTotal"),    key: "total",        format: "currency", align: "right", width: 15 },
          ],
          rows: bodyRows,
          totals: { total: data.grand_total },
        },
        baseFilename: `${isTopSelling ? "TopSellingReport" : "SalesReport"}${dateLabel}`,
      };
    }

    if (selectedReportType === "salesByPaymentReport") {
      const data = await api.get<SalesByPaymentReportData>(
        `/reports/sales-by-payment?date_from=${startDate}&date_to=${endDate}${shopParam}`,
      );

      // Helper: render a single shop's rows (retail block → Department
      // sub-section → optional dept row). Reused for both single-vendor and
      // multi-vendor admin layouts.
      const renderShopBlock = (shopRows: SalesByPaymentRow[]): Record<string, unknown>[] => {
        const retail = shopRows.filter((r) => r.payment_method.toUpperCase() !== "DEPARTMENT");
        const dept = shopRows.find((r) => r.payment_method.toUpperCase() === "DEPARTMENT");
        const block: Record<string, unknown>[] = [
          ...retail.map((r) => ({
            payment_method: t(`payment.${(r.payment_method ?? "").toLowerCase()}`) || r.payment_method,
            receipt_count: r.receipt_count,
            total: r.total,
          })),
          { [SECTION_KEY]: t("reports.deptUseHeader", "Department Use (Internal)") },
        ];
        if (dept) {
          block.push({ payment_method: "Department Use", receipt_count: dept.receipt_count, total: dept.total });
        }
        return block;
      };

      const multi = isMultiVendor(data.rows);
      let bodyRows: Record<string, unknown>[];
      const reportFilters = [...filters];

      if (multi) {
        const byShop = new Map<string, { name: string | null; rows: SalesByPaymentRow[] }>();
        for (const r of data.rows) {
          const e = byShop.get(r.shop_id);
          if (e) e.rows.push(r);
          else byShop.set(r.shop_id, { name: r.shop_name, rows: [r] });
        }
        bodyRows = [];
        for (const [shopId, { name, rows: shopRows }] of byShop) {
          bodyRows.push({ [SECTION_KEY]: `Vendor: ${name ?? shopId}` });
          bodyRows.push(...renderShopBlock(shopRows));
          bodyRows.push({
            [EMPHASIS_KEY]: "subtotal" as const,
            payment_method: "Subtotal",
            receipt_count: shopRows.reduce((s, r) => s + r.receipt_count, 0),
            total: shopRows.reduce((s, r) => s + r.total, 0),
          });
        }
      } else {
        bodyRows = renderShopBlock(data.rows);
        if (data.rows.length > 0) {
          reportFilters.push(`Shop: ${data.rows[0].shop_name ?? data.rows[0].shop_id}`);
        }
      }

      return {
        payload: {
          meta: {
            title: t("reports.salesByPaymentReport"),
            schoolName: school.name,
            schoolLogoUrl: school.logoUrl || undefined,
            reportId: REPORT_ID_MAP["salesByPaymentReport"],
            filters: reportFilters,
            runByName: user?.fullName ?? user?.username,
          },
          columns: [
            { header: t("reports.colPaymentMethod") || "Payment Method", key: "payment_method", width: 25 },
            { header: t("reports.colReceiptCount")  || "Receipt Count",  key: "receipt_count", format: "number",   align: "right", width: 15 },
            { header: t("reports.colTotal"),                              key: "total",         format: "currency", align: "right", width: 15 },
          ],
          rows: bodyRows,
          totals: { total: data.retail_total },
        },
        baseFilename: `SalesByPaymentReport${dateLabel}`,
      };
    }

    if (selectedReportType === "stockReport") {
      const stockShopParam = shopParam.replace(/^&/, "?");
      const data = await api.get<StockReportData>(`/reports/stock${stockShopParam}`);
      return {
        payload: {
          meta: {
            title: t("reports.stockReport"),
            schoolName: school.name,
            schoolLogoUrl: school.logoUrl || undefined,
            reportId: REPORT_ID_MAP["stockReport"],
            filters: [],
          },
          columns: [
            { header: t("reports.colShop"),        key: "shop_name",    width: 25 },
            { header: t("reports.colProductCode"), key: "product_code", width: 18 },
            { header: t("reports.colProduct"),     key: "product_name", width: 45 },
            { header: t("reports.colStock"),       key: "stock_qty",    format: "number", align: "right", width: 12 },
          ],
          rows: data.rows.map((r) => ({ ...r, shop_name: r.shop_name ?? r.shop_id })) as unknown as Record<string, unknown>[],
        },
        baseFilename: `StockBalanceReport`,
      };
    }

    if (selectedReportType === "returnReport") {
      const data = await api.get<{ rows: Record<string, unknown>[]; total_voided: number }>(
        `/reports/voids?date_from=${startDate}&date_to=${endDate}${shopParam}`,
      );
      return {
        payload: {
          meta: {
            title: t("reports.returnReport"),
            schoolName: school.name,
            schoolLogoUrl: school.logoUrl || undefined,
            reportId: REPORT_ID_MAP["returnReport"],
            filters,
          },
          columns: [
            { header: t("reports.colId"),       key: "id",              format: "number",   align: "right", width: 8  },
            { header: t("reports.colDate"),      key: "voided_at",       format: "datetime",                 width: 18 },
            { header: t("reports.colReceipt"),   key: "receipt_number",                                      width: 20 },
            { header: t("reports.colTotal"),     key: "total",           format: "currency", align: "right", width: 14 },
            { header: "Voided By",               key: "voided_by_name",                                      width: 20 },
            { header: "Reason",                  key: "voided_reason",                                       width: 30 },
          ],
          rows: data.rows,
          totals: { total: data.total_voided },
        },
        baseFilename: `VoidReport${dateLabel}`,
      };
    }

    return null;
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const result = await buildDialogReportPayload();
      if (!result) return;
      exportToExcel(result.payload, `${result.baseFilename}.xlsx`);
      toast.success(t("reports.exportSuccess"));
      setIsDatePickerOpen(false);
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric");
      toast.error(detail);
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const result = await buildDialogReportPayload();
      if (!result) return;
      await exportToPDF(result.payload, `${result.baseFilename}.pdf`);
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
        {visibleReports.map(({ type, icon: Icon }) => (
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
                {user?.role === "admin" && (
                  <div className="space-y-2">
                    <Label htmlFor="scShop">{t("reports.colShop")}</Label>
                    <Select value={stockCardShopId} onValueChange={setStockCardShopId}>
                      <SelectTrigger id="scShop">
                        <SelectValue placeholder={t("reports.selectShopPlaceholder", "Select shop")} />
                      </SelectTrigger>
                      <SelectContent>
                        {stockCardShops.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className={`space-y-2 ${user?.role === "admin" ? "md:col-span-2" : "md:col-span-3"}`}>
                  <Label>{t("reports.startDate")} — {t("reports.endDate")}</Label>
                  <DateRangePicker
                    id="scDateRange"
                    startDate={stockCardFrom}
                    endDate={stockCardTo}
                    onStartChange={(v) => { setStockCardFrom(v); setStockCardData(null); }}
                    onEndChange={(v) => { setStockCardTo(v); setStockCardData(null); }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="scProductSearch">
                    {t("reports.stockCard.productSearch", "Product")}
                  </Label>
                  <Input
                    id="scProductSearch"
                    value={stockCardProductSearch}
                    onChange={(e) => {
                      setStockCardProductSearch(e.target.value);
                      setStockCardData(null);
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleLoadStockCard(); }}
                    placeholder={t(
                      "reports.stockCard.productSearchPlaceholder",
                      "Search by code, name, or barcode",
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scCategory">
                    {t("reports.stockCard.category", "Category")}
                  </Label>
                  <Select value={stockCardCategory} onValueChange={(v) => { setStockCardCategory(v); setStockCardData(null); }}>
                    <SelectTrigger id="scCategory">
                      <SelectValue
                        placeholder={t("reports.stockCard.allCategories", "All categories")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {t("reports.stockCard.allCategories", "All categories")}
                      </SelectItem>
                      {stockCardCategories.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scIncludeEmpty">
                    {t("reports.stockCard.showEmpty", "Show products with no movement")}
                  </Label>
                  <div className="flex items-center h-10 gap-2">
                    <input
                      id="scIncludeEmpty"
                      type="checkbox"
                      checked={stockCardIncludeEmpty}
                      onChange={(e) => setStockCardIncludeEmpty(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <span className="text-xs text-muted-foreground">
                      {t(
                        "reports.stockCard.showEmptyHint",
                        "Include items that had no sales and zero opening balance",
                      )}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleLoadStockCard} disabled={stockCardLoading}>
                  {stockCardLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  {t("reports.stockCard.load")}
                </Button>
                {stockCardData && stockCardData.products.length > 0 && (
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
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium">{stockCardData.shop_name ?? stockCardData.shop_id ?? "—"}</span>
                    {" · "}{stockCardData.date_from} → {stockCardData.date_to}
                  </div>
                  {stockCardData.products.length === 0 ? (
                    <div className="rounded-md border p-6 text-center text-muted-foreground text-sm">
                      {t("reports.stockCard.noMovements")}
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-2 py-2 text-left">{t("reports.colDate")}</th>
                            <th className="px-2 py-2 text-left">Description</th>
                            <th className="px-2 py-2 text-left">Invoice No.</th>
                            <th className="px-2 py-2 text-right">Qty In</th>
                            <th className="px-2 py-2 text-right">Qty Out</th>
                            <th className="px-2 py-2 text-right">Qty Bal.</th>
                            <th className="px-2 py-2 text-right">Amt In</th>
                            <th className="px-2 py-2 text-right">Amt Out</th>
                            <th className="px-2 py-2 text-right">Cost/Unit</th>
                            <th className="px-2 py-2 text-right">Amt Bal.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stockCardData.products.map((block) => (
                            <React.Fragment key={block.product_variant_id}>
                              <tr className="border-t bg-secondary/40">
                                <td className="px-2 py-2 font-semibold" colSpan={10}>
                                  Product Code {block.product_code} &nbsp;&nbsp; {block.product_name}
                                </td>
                              </tr>
                              {block.rows.map((row, i) => (
                                <tr key={`${block.product_variant_id}-${i}`} className="border-t">
                                  <td className="px-2 py-1 whitespace-nowrap">
                                    {row.date ? row.date.slice(0, 10) : ""}
                                  </td>
                                  <td className="px-2 py-1">{row.description}</td>
                                  <td className="px-2 py-1">{row.invoice_no ?? ""}</td>
                                  <td className="px-2 py-1 text-right font-mono">{row.qty_in || ""}</td>
                                  <td className="px-2 py-1 text-right font-mono">{row.qty_out || ""}</td>
                                  <td className="px-2 py-1 text-right font-mono">{row.qty_balance}</td>
                                  <td className="px-2 py-1 text-right font-mono">{row.amount_in ? row.amount_in.toFixed(2) : ""}</td>
                                  <td className="px-2 py-1 text-right font-mono">{row.amount_out ? row.amount_out.toFixed(2) : ""}</td>
                                  <td className="px-2 py-1 text-right font-mono">{row.cost_per_unit ? row.cost_per_unit.toFixed(2) : ""}</td>
                                  <td className="px-2 py-1 text-right font-mono">{row.amount_balance.toFixed(2)}</td>
                                </tr>
                              ))}
                              <tr className="border-t font-semibold bg-muted/30">
                                <td className="px-2 py-1"></td>
                                <td className="px-2 py-1">Total :</td>
                                <td></td>
                                <td className="px-2 py-1 text-right font-mono">{block.total_qty_in || ""}</td>
                                <td className="px-2 py-1 text-right font-mono">{block.total_qty_out || ""}</td>
                                <td></td>
                                <td className="px-2 py-1 text-right font-mono">{block.total_amount_in ? block.total_amount_in.toFixed(2) : ""}</td>
                                <td className="px-2 py-1 text-right font-mono">{block.total_amount_out ? block.total_amount_out.toFixed(2) : ""}</td>
                                <td></td>
                                <td></td>
                              </tr>
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
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
                    <Select value={selectedStall} onValueChange={setSelectedStall}>
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
                          <th className="px-2 py-2 text-right">Amt. Other</th>
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
                  <Input id="siUserName" placeholder="Search user name"
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
                {needsShopSelector && (
                  <div className="space-y-2">
                    <Label htmlFor="siShop">Shop</Label>
                    <Select value={selectedStall} onValueChange={setSelectedStall}>
                      <SelectTrigger id="siShop"><SelectValue /></SelectTrigger>
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
                          <th className="px-2 py-2 text-right">Seq.</th>
                          <th className="px-2 py-2 text-left">Date/Time</th>
                          <th className="px-2 py-2 text-left">Item NO.</th>
                          <th className="px-2 py-2 text-left">Item Name</th>
                          <th className="px-2 py-2 text-left">Receipt NO.</th>
                          <th className="px-2 py-2 text-left">ID.</th>
                          <th className="px-2 py-2 text-left">Name</th>
                          <th className="px-2 py-2 text-right">Sales Qty.</th>
                          <th className="px-2 py-2 text-right">Sales AMT.</th>
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
            {needsShopSelector && (
              <div className="space-y-2">
                <Label>{t("reports.canteenScope")}</Label>
                <Select value={selectedStall} onValueChange={setSelectedStall}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("reports.canteenScopeAll")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{isCanteenReportsPage ? t("reports.canteenScopeAll") : "All shops"}</SelectItem>
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
            <Button variant="outline" onClick={handleExportPdf} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
              {t("reports.exportPdf", "Export PDF")}
            </Button>
            <Button onClick={handleExportExcel} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
              {t("reports.exportExcel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Reports;
