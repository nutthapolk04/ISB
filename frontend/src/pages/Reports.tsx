import { useState, useEffect, useMemo } from "react";
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
import { buildVendorSections, isMultiVendor, type CanteenShop } from "./reports/reportHelpers";
import { StockCardReport } from "./reports/StockCardReport";
import { SalesSummaryReport } from "./reports/SalesSummaryReport";
import { SalesByItemReport } from "./reports/SalesByItemReport";
import { BundleReport } from "./reports/BundleReport";

interface SalesRow {
    product_name: string;
    quantity: number;
    total: number;
    shop_id: string;
    shop_name: string | null;
    status: string;
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
    status: string;
}
interface SalesByPaymentReportData {
    rows: SalesByPaymentRow[];
    grand_total: number;
    total_receipts: number;
    retail_total: number;
    department_total: number;
    department_receipts: number;
}

// Reports that apply to BOTH modules (canteen + store). Void receipts can
// happen in either module, so returnReport (title: "Void") lives here even
// though it's named after the older "returns" concept.
const COMMON_REPORTS = [
    { type: "salesReport", icon: FileText, needsRange: true },
    { type: "topSellingReport", icon: TrendingUp, needsRange: true },
    { type: "salesByPaymentReport", icon: CreditCard, needsRange: true },
    { type: "salesSummaryReport", icon: FileText, needsRange: false },
    { type: "salesByItemReport", icon: Package, needsRange: false },
    { type: "returnReport", icon: ArrowLeftRight, needsRange: true },
] satisfies { type: string; icon: typeof FileText; needsRange: boolean }[];

// Store-only reports — these don't make sense in a canteen context. Canteen
// uses portion-based daily prep rather than SKU-level stock tracking, so
// per-SKU stock and stock-card reports belong to the store/coop module only.
const STORE_ONLY_REPORTS = [
    { type: "stockReport", icon: Package, needsRange: false },
    { type: "stockCardReport", icon: ClipboardList, needsRange: true },
    { type: "bundleReport", icon: Package, needsRange: false },
] satisfies { type: string; icon: typeof FileText; needsRange: boolean }[];

const REPORT_DEFS = [...COMMON_REPORTS, ...STORE_ONLY_REPORTS];

const Reports = () => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const school = useSchoolInfo();
    const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
    const [selectedReportType, setSelectedReportType] = useState<string>("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [exporting, setExporting] = useState(false);
    // Bumped on every report-tile click so the inline panel components below
    // remount (via `key`) and reset their internal state — this preserves the
    // old behavior where re-clicking an already-open report cleared its data.
    const [reportOpenNonce, setReportOpenNonce] = useState(0);

    // Determine which module's Reports page we're rendering. /canteen/reports
    // narrows the visible cards to canteen-relevant ones; /store/reports gets
    // the full store set. Admin uses /admin/reports (AdminReports) instead.
    const location = useLocation();
    const isCanteenReportsPage = location.pathname.startsWith("/canteen/");

    // N = canteen, S = store — same catalog numbers as before, just prefixed
    // per module instead of a shared "ISB" prefix, so the exported Report ID
    // also identifies which side (canteen/store) it came from.
    const REPORT_ID_MAP: Record<string, string> = isCanteenReportsPage
        ? {
            salesReport: "N001",
            topSellingReport: "N002",
            salesByPaymentReport: "N003",
            salesSummaryReport: "N004",
            salesByItemReport: "N005",
            returnReport: "N006",
        }
        : {
            salesReport: "S006",
            topSellingReport: "S007",
            salesByPaymentReport: "S008",
            salesSummaryReport: "S009",
            salesByItemReport: "S010",
            stockReport: "S011",
            returnReport: "S012",
            stockCardReport: "S013",
            bundleReport: "S014",
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
        api.get<CanteenShop[]>(`/shops?module=${module}`).then(setCanteenStalls).catch(() => { });
    }, [needsShopSelector, isCanteenReportsPage]);

    const currentDef = REPORT_DEFS.find((d) => d.type === selectedReportType);
    const needsRange = currentDef?.needsRange ?? true;

    const handleReportClick = (reportType: string) => {
        if (
            reportType === "stockCardReport" ||
            reportType === "salesReport" ||
            reportType === "salesSummaryReport" ||
            reportType === "salesByItemReport" ||
            reportType === "bundleReport"
        ) {
            setSelectedReportType(reportType);
            setReportOpenNonce((n) => n + 1);
            return;
        }
        setSelectedReportType(reportType);
        setStartDate("");
        setEndDate("");
        setSelectedStall("all");
        setIsDatePickerOpen(true);
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

        if (selectedReportType === "topSellingReport") {
            const data = await api.get<SalesReportData>(
                `/reports/sales?date_from=${startDate}&date_to=${endDate}${shopParam}`,
            );
            // Top Selling keeps its own ranking rule — a voided line never
            // "sold", so it's excluded entirely rather than shown in the
            // ranking — but now renders with what used to be Sales Report's
            // template (Status column + vendor subtotal grouping), per the
            // customer's requested template swap. Sales Report itself moved
            // to the Sales by Item Report template/component below. See
            // reports/legacyReportTemplates.ts for the original 3-column,
            // ungrouped layout this replaced.
            const sortedRows = data.rows.filter((r) => r.status === "ACTIVE").sort((a, b) => b.quantity - a.quantity);

            const multi = isMultiVendor(sortedRows);
            const bodyRows = multi
                ? buildVendorSections(sortedRows, (shopRows) => {
                    const active = shopRows.filter((r) => r.status === "ACTIVE");
                    return {
                        product_name: "Subtotal",
                        quantity: active.reduce((s, r) => s + r.quantity, 0),
                        total: active.reduce((s, r) => s + r.total, 0),
                    };
                })
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
                        { header: t("reports.colProduct"), key: "product_name", width: 40 },
                        { header: t("reports.colQuantity"), key: "quantity", format: "number", align: "right", width: 12 },
                        { header: t("reports.colTotal"), key: "total", format: "currency", align: "right", width: 15 },
                        { header: "Status", key: "status", width: 15 },
                    ],
                    rows: bodyRows,
                    totals: { total: data.grand_total },
                },
                baseFilename: `TopSellingReport${dateLabel}`,
            };
        }

        if (selectedReportType === "salesByPaymentReport") {
            const data = await api.get<SalesByPaymentReportData>(
                `/reports/sales-by-payment?date_from=${startDate}&date_to=${endDate}${shopParam}`,
            );

            // Display label for a raw receipts.payment_method enum value. Several
            // raw values collapse into the same displayed bucket (e.g. WALLET and
            // CARD_TAP are both "Campus Card") — this is display-only and doesn't
            // go through i18n (this report's labels are English-only by design,
            // matching the Sales Summary / Daily Sales Report convention).
            const METHOD_LABEL_FOR = (method: string): string => {
                const m = (method ?? "").toUpperCase();
                if (m === "CASH") return "Cash";
                if (m === "WALLET" || m === "CARD_TAP") return "Campus Card";
                if (m === "CREDIT_CARD" || m === "DEBIT_CARD" || m === "EDC") return "Credit Card";
                if (m === "BANK_TRANSFER" || m === "QR_PROMPTPAY") return "QR Code";
                if (m === "DEPARTMENT") return "Department Use";
                return "Other";
            };
            // Fixed display order for method sections — only sections that
            // actually have rows get emitted (no empty "Credit Card" header
            // when nothing was paid that way).
            const METHOD_LABEL_ORDER = ["Cash", "Campus Card", "Credit Card", "QR Code", "Department Use", "Other"];

            // Helper: render one shop's rows grouped by payment-method bucket —
            // a section header per bucket ("Cash", "Campus Card", ...), one row
            // per status within it (ACTIVE first, then VOIDED), then a
            // "Total <Bucket>" subtotal row. Reused for both single-vendor and
            // multi-vendor admin layouts.
            const renderMethodGroups = (shopRows: SalesByPaymentRow[]): Record<string, unknown>[] => {
                const byLabel = new Map<string, Map<string, { receipt_count: number; total: number }>>();
                for (const r of shopRows) {
                    const label = METHOD_LABEL_FOR(r.payment_method);
                    const byStatus = byLabel.get(label) ?? new Map<string, { receipt_count: number; total: number }>();
                    const cur = byStatus.get(r.status) ?? { receipt_count: 0, total: 0 };
                    cur.receipt_count += r.receipt_count;
                    cur.total += r.total;
                    byStatus.set(r.status, cur);
                    byLabel.set(label, byStatus);
                }

                const block: Record<string, unknown>[] = [];
                for (const label of METHOD_LABEL_ORDER) {
                    const byStatus = byLabel.get(label);
                    if (!byStatus) continue;
                    block.push({ [SECTION_KEY]: label });
                    const statuses = [...byStatus.keys()].sort((a, b) => (a === "ACTIVE" ? -1 : b === "ACTIVE" ? 1 : 0));
                    let subtotal = 0;
                    for (const status of statuses) {
                        const v = byStatus.get(status)!;
                        block.push({ payment_method: label, receipt_count: v.receipt_count, total: v.total, status });
                        subtotal += v.total;
                    }
                    block.push({
                        [EMPHASIS_KEY]: "subtotal" as const,
                        receipt_count: `Total ${label}`,
                        total: subtotal,
                    });
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
                    // Exclude Department Use so this subtotal matches the page-level
                    // TOTAL footer below (data.retail_total), which also excludes it.
                    const activeShopRows = shopRows.filter(
                        (r) => r.status === "ACTIVE" && r.payment_method.toUpperCase() !== "DEPARTMENT",
                    );
                    bodyRows.push({ [SECTION_KEY]: `Vendor: ${name ?? shopId}` });
                    bodyRows.push(...renderMethodGroups(shopRows));
                    bodyRows.push({
                        [EMPHASIS_KEY]: "subtotal" as const,
                        payment_method: "Subtotal",
                        receipt_count: activeShopRows.reduce((s, r) => s + r.receipt_count, 0),
                        total: activeShopRows.reduce((s, r) => s + r.total, 0),
                    });
                }
            } else {
                bodyRows = renderMethodGroups(data.rows);
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
                        { header: t("reports.colReceiptCount") || "Receipt Count", key: "receipt_count", format: "number", align: "right", width: 15 },
                        { header: t("reports.colTotal"), key: "total", format: "currency", align: "right", width: 15 },
                        { header: "Status", key: "status", width: 15 },
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
                        { header: t("reports.colShop"), key: "shop_name", width: 25 },
                        { header: t("reports.colProductCode"), key: "product_code", width: 18 },
                        { header: t("reports.colProduct"), key: "product_name", width: 45 },
                        { header: t("reports.colStock"), key: "stock_qty", format: "number", align: "right", width: 12 },
                    ],
                    rows: data.rows.map((r) => ({ ...r, shop_name: r.shop_name ?? r.shop_id })) as unknown as Record<string, unknown>[],
                },
                baseFilename: `StockBalanceReport`,
            };
        }

        if (selectedReportType === "returnReport") {
            // Backend already groups by calendar day and provides a per-day
            // subtotal (VoidReport.daily[].daily_total) — this used to be
            // re-derived client-side from a flat `rows` array the backend
            // no longer returns, which made `data.rows` undefined and threw
            // inside this branch (silently caught as a generic export error).
            const data = await api.get<{
                daily: Array<{
                    date: string;
                    rows: Array<{ id: number; voided_at: string; receipt_number: string; total: number; voided_by_name: string | null; voided_reason: string | null }>;
                    daily_total: number;
                }>;
                total_voided: number;
            }>(`/reports/voids?date_from=${startDate}&date_to=${endDate}${shopParam}`);

            const bodyRows: Record<string, unknown>[] = [];
            for (const { date, rows: dayRows, daily_total } of data.daily) {
                bodyRows.push({ [SECTION_KEY]: date });
                bodyRows.push(...(dayRows as unknown as Record<string, unknown>[]));
                bodyRows.push({
                    [EMPHASIS_KEY]: "subtotal" as const,
                    receipt_number: `Subtotal (${dayRows.length})`,
                    total: daily_total,
                });
            }

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
                        { header: t("reports.colId"), key: "id", format: "number", align: "right", width: 8 },
                        { header: t("reports.colDate"), key: "voided_at", format: "datetime", width: 18 },
                        { header: t("reports.colReceipt"), key: "receipt_number", width: 20 },
                        { header: t("reports.colTotal"), key: "total", format: "currency", align: "right", width: 14 },
                        { header: "Voided By", key: "voided_by_name", width: 20 },
                        { header: "Reason", key: "voided_reason", width: 30 },
                    ],
                    rows: bodyRows,
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

            {selectedReportType === "stockCardReport" && (
                <StockCardReport
                    key={reportOpenNonce}
                    reportId={REPORT_ID_MAP["stockCardReport"]}
                    isCanteenReportsPage={isCanteenReportsPage}
                />
            )}

            {selectedReportType === "salesSummaryReport" && (
                <SalesSummaryReport
                    key={reportOpenNonce}
                    reportId={REPORT_ID_MAP["salesSummaryReport"]}
                    needsShopSelector={needsShopSelector}
                    isCanteenReportsPage={isCanteenReportsPage}
                    selectedStall={selectedStall}
                    onSelectedStallChange={setSelectedStall}
                    canteenStalls={canteenStalls}
                />
            )}

            {selectedReportType === "salesReport" && (
                // Per the customer's requested template swap, Sales Report now
                // reuses the Sales by Item Report template/component (own
                // reportId + title so exports still identify as "Sales Report").
                // Its original inline-dialog template lives on in
                // reports/legacyReportTemplates.ts as a backup.
                <SalesByItemReport
                    key={reportOpenNonce}
                    reportId={REPORT_ID_MAP["salesReport"]}
                    needsShopSelector={needsShopSelector}
                    isCanteenReportsPage={isCanteenReportsPage}
                    selectedStall={selectedStall}
                    onSelectedStallChange={setSelectedStall}
                    canteenStalls={canteenStalls}
                    title={t("reports.salesReport")}
                    filenamePrefix="SalesReport"
                    rankByBestSelling={false}
                />
            )}

            {selectedReportType === "salesByItemReport" && (
                <SalesByItemReport
                    key={reportOpenNonce}
                    reportId={REPORT_ID_MAP["salesByItemReport"]}
                    needsShopSelector={needsShopSelector}
                    isCanteenReportsPage={isCanteenReportsPage}
                    selectedStall={selectedStall}
                    onSelectedStallChange={setSelectedStall}
                    canteenStalls={canteenStalls}
                />
            )}

            {selectedReportType === "bundleReport" && (
                <BundleReport
                    key={reportOpenNonce}
                    reportId={REPORT_ID_MAP["bundleReport"]}
                />
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
