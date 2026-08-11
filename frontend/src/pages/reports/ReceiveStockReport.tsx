import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { FileSpreadsheet, FileText, Loader2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    sanitizeFilename,
    type ReportColumn,
    type ReportPayload,
} from "@/lib/reportExport";
import { PaginationBar } from "@/components/PaginationBar";
import { SortableDateTimeHeader } from "@/components/SortableDateTimeHeader";
import { DEFAULT_DATE_TIME_SORT, toggleDateTimeSort, type DateTimeSortDir } from "@/lib/dateTimeSort";
import { fmtDateTime, fmtDate } from "@/lib/dateFormat";
import type { CanteenShop } from "./reportHelpers";

const RS_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

interface ReceiveStockRow {
    seq: number;
    date: string;
    received_date: string | null;
    product_code: string | null;
    product_name: string;
    shop_id: string;
    shop_name: string | null;
    quantity: number;
    cost_per_unit: number;
    total_cost: number;
    po_number: string | null;
    invoice_number: string | null;
    note: string | null;
    created_by_name: string | null;
}

interface ReceiveStockTotals {
    quantity: number;
    total_cost: number;
}

interface ReceiveStockReportData {
    date_from: string | null;
    date_to: string | null;
    shop_id: string | null;
    rows: ReceiveStockRow[];
    totals: ReceiveStockTotals;
    line_count: number;
}

interface ReceiveStockReportProps {
    reportId: string;
    needsShopSelector: boolean;
    isCanteenReportsPage: boolean;
    selectedStall: string;
    onSelectedStallChange: (v: string) => void;
    canteenStalls: CanteenShop[];
}

export function ReceiveStockReport({
    reportId,
    needsShopSelector,
    isCanteenReportsPage,
    selectedStall,
    onSelectedStallChange,
    canteenStalls,
}: ReceiveStockReportProps) {
    const { t } = useTranslation();
    const { user } = useAuth();
    const school = useSchoolInfo();

    const [rsDateFrom, setRsDateFrom] = useState("");
    const [rsDateTo, setRsDateTo] = useState("");
    const [rsProductSearch, setRsProductSearch] = useState("");
    const [rsPoNumber, setRsPoNumber] = useState("");
    const [rsInvoiceNumber, setRsInvoiceNumber] = useState("");
    const [rsLoading, setRsLoading] = useState(false);
    const [rsData, setRsData] = useState<ReceiveStockReportData | null>(null);
    const [rsPage, setRsPage] = useState(1);
    const [rsPageSize, setRsPageSize] = useState(25);
    const [rsDateTimeSort, setRsDateTimeSort] = useState<DateTimeSortDir>(DEFAULT_DATE_TIME_SORT);

    useEffect(() => {
        setRsPage(1);
    }, [rsData, rsPageSize]);

    const buildReceiveStockQuery = (sort = rsDateTimeSort): string => {
        const params = new URLSearchParams();
        if (rsDateFrom) params.set("date_from", rsDateFrom);
        if (rsDateTo) params.set("date_to", rsDateTo);
        if (rsProductSearch.trim()) params.set("product_search", rsProductSearch.trim());
        if (rsPoNumber.trim()) params.set("po_number", rsPoNumber.trim());
        if (rsInvoiceNumber.trim()) params.set("invoice_number", rsInvoiceNumber.trim());
        params.set("sort_order", sort);
        if (needsShopSelector) {
            if (selectedStall === "all") params.set("module", isCanteenReportsPage ? "canteen" : "store");
            else params.set("shop_id", selectedStall);
        } else if (user?.shopId) {
            params.set("shop_id", user.shopId);
        }
        return params.toString();
    };

    const handleLoadReceiveStock = async (sort = rsDateTimeSort) => {
        setRsLoading(true);
        try {
            const qs = buildReceiveStockQuery(sort);
            const data = await api.get<ReceiveStockReportData>(
                `/reports/receive-stock${qs ? `?${qs}` : ""}`,
            );
            setRsData(data);
            if (data.rows.length === 0) toast.message("No receiving transactions match these filters.");
        } catch (err) {
            const detail = err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric");
            toast.error(detail);
        } finally {
            setRsLoading(false);
        }
    };

    const buildReceiveStockFilterLines = (): string[] => {
        const lines: string[] = [];
        const dateLine = buildDateFilterLine("Date", rsDateFrom, rsDateTo);
        if (dateLine) lines.push(dateLine);
        if (rsProductSearch.trim()) lines.push(`Product: ${rsProductSearch.trim()}`);
        if (rsPoNumber.trim()) lines.push(`PO No.: ${rsPoNumber.trim()}`);
        if (rsInvoiceNumber.trim()) lines.push(`Invoice No.: ${rsInvoiceNumber.trim()}`);
        if (needsShopSelector && selectedStall !== "all") {
            const stall = canteenStalls.find((s) => s.id === selectedStall);
            if (stall) lines.push(`Shop: ${stall.name}`);
        }
        return lines;
    };

    const buildReceiveStockPayload = (): ReportPayload<Record<string, unknown>> | null => {
        if (!rsData) return null;

        const columns: ReportColumn[] = [
            { header: "Seq.", key: "seq", format: "number", align: "right", width: 32 },
            { header: "Date/Time", key: "date", format: "datetime", width: 95 },
            { header: "Received Date", key: "received_date", width: 70 },
            { header: "Item NO.", key: "product_code", width: 70 },
            { header: "Item Name", key: "product_name", width: 130 },
            { header: "Shop", key: "shop_name", width: 70 },
            { header: "Qty", key: "quantity", format: "number", align: "right", width: 45 },
            { header: "Cost/Unit", key: "cost_per_unit", format: "currency", align: "right", width: 60 },
            { header: "Total Cost", key: "total_cost", format: "currency", align: "right", width: 70 },
            { header: "PO No.", key: "po_number", width: 65 },
            { header: "Invoice No.", key: "invoice_number", width: 65 },
            { header: "Note", key: "note", width: 90 },
            { header: "Received By", key: "created_by_name", width: 75 },
        ];

        return {
            meta: {
                title: "Receive Stock Report",
                schoolName: school.name,
                schoolLogoUrl: school.logoUrl || undefined,
                reportId,
                filters: buildReceiveStockFilterLines(),
            },
            columns,
            rows: rsData.rows.map((r) => ({
                ...r,
                // Pre-formatted as text (not format:"date") so the placeholder for
                // rows with no delivery date matches what the web table shows,
                // instead of a date formatter rendering its own dash.
                received_date: r.received_date ? fmtDate(r.received_date) : "-",
                shop_name: r.shop_name ?? r.shop_id,
                po_number: r.po_number ?? "",
                invoice_number: r.invoice_number ?? "",
                note: r.note ?? "",
                created_by_name: r.created_by_name ?? "",
            })) as unknown as Record<string, unknown>[],
            totals: {
                quantity: rsData.totals.quantity,
                total_cost: rsData.totals.total_cost,
            },
        };
    };

    const handleExportReceiveStockPdf = async () => {
        const payload = buildReceiveStockPayload();
        if (!payload || !rsData) return;
        try {
            const fname = `ReceiveStockReport_${sanitizeFilename(rsDateFrom || "any")}_${sanitizeFilename(rsDateTo || "any")}.pdf`;
            await exportToPDF(payload, fname);
            toast.success(t("reports.exportSuccess"));
        } catch (err) {
            const detail = err instanceof Error ? err.message : t("shopUsers.errorGeneric");
            toast.error(detail);
        }
    };

    const handleExportReceiveStockExcel = () => {
        const payload = buildReceiveStockPayload();
        if (!payload || !rsData) return;
        try {
            const fname = `ReceiveStockReport_${sanitizeFilename(rsDateFrom || "any")}_${sanitizeFilename(rsDateTo || "any")}.xlsx`;
            exportToExcel(payload, fname);
            toast.success(t("reports.exportSuccess"));
        } catch (err) {
            const detail = err instanceof Error ? err.message : t("shopUsers.errorGeneric");
            toast.error(detail);
        }
    };

    const rsTotalPages = Math.max(1, Math.ceil((rsData?.rows.length ?? 0) / rsPageSize));

    return (
        <div className="mt-6 space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Truck className="h-5 w-5 text-primary" />
                        {t("reports.receiveStockReport", "Receive Stock Report")}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                        All filters are optional. Leave any field blank to skip that filter.
                    </p>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="space-y-2 md:col-span-2 lg:col-span-2">
                            <Label>Date Range</Label>
                            <DateRangePicker
                                id="rsDateRange"
                                startDate={rsDateFrom}
                                endDate={rsDateTo}
                                onStartChange={setRsDateFrom}
                                onEndChange={setRsDateTo}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="rsProductSearch">Product</Label>
                            <Input
                                id="rsProductSearch"
                                placeholder="Search by code or name"
                                value={rsProductSearch}
                                onChange={(e) => setRsProductSearch(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") handleLoadReceiveStock(); }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="rsPoNumber">PO No.</Label>
                            <Input
                                id="rsPoNumber"
                                placeholder="Search PO number"
                                value={rsPoNumber}
                                onChange={(e) => setRsPoNumber(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") handleLoadReceiveStock(); }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="rsInvoiceNumber">Invoice No.</Label>
                            <Input
                                id="rsInvoiceNumber"
                                placeholder="Search invoice number"
                                value={rsInvoiceNumber}
                                onChange={(e) => setRsInvoiceNumber(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") handleLoadReceiveStock(); }}
                            />
                        </div>
                        {needsShopSelector && (
                            <div className="space-y-2">
                                <Label htmlFor="rsShop">Shop</Label>
                                <Select value={selectedStall} onValueChange={onSelectedStallChange}>
                                    <SelectTrigger id="rsShop"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All shops</SelectItem>
                                        {canteenStalls.map((s) => (
                                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <Button onClick={() => handleLoadReceiveStock()} disabled={rsLoading}>
                            {rsLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            Search
                        </Button>
                        {rsData && (
                            <>
                                <Button variant="outline" onClick={handleExportReceiveStockPdf}>
                                    <FileText className="h-4 w-4 mr-2" />
                                    Export PDF
                                </Button>
                                <Button variant="outline" onClick={handleExportReceiveStockExcel}>
                                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                                    Export Excel
                                </Button>
                            </>
                        )}
                    </div>

                    {rsData && (
                        <div className="space-y-3">
                            <div className="text-sm text-muted-foreground">
                                Found <span className="font-semibold text-foreground">{rsData.line_count}</span> receiving transactions
                                {" · "}Total Qty{" "}
                                <span className="font-semibold text-foreground">{rsData.totals.quantity}</span>
                                {" · "}Total Cost{" "}
                                <span className="font-semibold text-foreground">
                                    ฿{rsData.totals.total_cost.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                                </span>
                            </div>
                            <div className="overflow-x-auto rounded-md border">
                                <table className="w-full text-xs">
                                    <thead className="bg-muted/50 whitespace-nowrap">
                                        <tr>
                                            <th className="px-2 py-2 text-right">Seq.</th>
                                            <SortableDateTimeHeader
                                                label="Date/Time"
                                                sortDir={rsDateTimeSort}
                                                onToggle={async () => {
                                                    const next = toggleDateTimeSort(rsDateTimeSort);
                                                    setRsDateTimeSort(next);
                                                    if (rsData) await handleLoadReceiveStock(next);
                                                }}
                                            />
                                            <th className="px-2 py-2 text-left">Received Date</th>
                                            <th className="px-2 py-2 text-left">Item NO.</th>
                                            <th className="px-2 py-2 text-left">Item Name</th>
                                            <th className="px-2 py-2 text-left">Shop</th>
                                            <th className="px-2 py-2 text-right">Qty</th>
                                            <th className="px-2 py-2 text-right">Cost/Unit</th>
                                            <th className="px-2 py-2 text-right">Total Cost</th>
                                            <th className="px-2 py-2 text-left">PO No.</th>
                                            <th className="px-2 py-2 text-left">Invoice No.</th>
                                            <th className="px-2 py-2 text-left">Note</th>
                                            <th className="px-2 py-2 text-left">Received By</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rsData.rows.length === 0 ? (
                                            <tr>
                                                <td colSpan={13} className="px-3 py-4 text-center text-muted-foreground">
                                                    No receiving transactions match these filters.
                                                </td>
                                            </tr>
                                        ) : (
                                            rsData.rows.slice((rsPage - 1) * rsPageSize, rsPage * rsPageSize).map((r) => (
                                                <tr key={r.seq} className="border-t">
                                                    <td className="px-2 py-1.5 text-right font-mono">{r.seq}</td>
                                                    <td className="px-2 py-1.5 whitespace-nowrap">{fmtDateTime(r.date)}</td>
                                                    <td className="px-2 py-1.5 whitespace-nowrap">
                                                        {r.received_date ? fmtDate(r.received_date) : "-"}
                                                    </td>
                                                    <td className="px-2 py-1.5 font-mono">{r.product_code ?? "—"}</td>
                                                    <td className="px-2 py-1.5">{r.product_name}</td>
                                                    <td className="px-2 py-1.5">{r.shop_name ?? r.shop_id}</td>
                                                    <td className="px-2 py-1.5 text-right font-mono">{r.quantity}</td>
                                                    <td className="px-2 py-1.5 text-right font-mono">{r.cost_per_unit.toFixed(2)}</td>
                                                    <td className="px-2 py-1.5 text-right font-mono">{r.total_cost.toFixed(2)}</td>
                                                    <td className="px-2 py-1.5">{r.po_number ?? ""}</td>
                                                    <td className="px-2 py-1.5">{r.invoice_number ?? ""}</td>
                                                    <td className="px-2 py-1.5 text-muted-foreground">{r.note ?? ""}</td>
                                                    <td className="px-2 py-1.5">{r.created_by_name ?? "—"}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                    {rsData.rows.length > 0 && (
                                        <tfoot className="bg-muted/30 font-semibold whitespace-nowrap">
                                            <tr className="border-t">
                                                <td colSpan={6} className="px-2 py-2 text-left">TOTAL</td>
                                                <td className="px-2 py-2 text-right font-mono">{rsData.totals.quantity}</td>
                                                <td />
                                                <td className="px-2 py-2 text-right font-mono">{rsData.totals.total_cost.toFixed(2)}</td>
                                                <td colSpan={4} />
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</Label>
                                    <Select value={String(rsPageSize)} onValueChange={(v) => setRsPageSize(parseInt(v))}>
                                        <SelectTrigger className="w-20 h-8 text-xs"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {RS_PAGE_SIZE_OPTIONS.map((n) => (
                                                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <PaginationBar currentPage={rsPage} totalPages={rsTotalPages} onPageChange={setRsPage} />
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
