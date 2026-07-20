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
import { FileSpreadsheet, FileText, Loader2, Package } from "lucide-react";
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
    type ReportColumn,
    type ReportPayload,
} from "@/lib/reportExport";
import type { CanteenShop } from "./reportHelpers";

interface SalesByItemRow {
    seq: number;
    transaction_date: string;
    item_no: string | null;
    item_name: string;
    is_bundle: boolean;
    receipt_number: string;
    customer_id: string | null;
    customer_name: string | null;
    sales_qty: number;
    sales_amt: number;
    receive_type: string;
    remark: string | null;
    status: string;
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

interface SalesByItemReportProps {
    reportId: string;
    needsShopSelector: boolean;
    isCanteenReportsPage: boolean;
    selectedStall: string;
    onSelectedStallChange: (v: string) => void;
    canteenStalls: CanteenShop[];
    /** Lets a different report card (e.g. "Sales Report") reuse this exact
     * template under its own name — see Reports.tsx's `salesReport` gate. */
    title?: string;
    filenamePrefix?: string;
}

export function SalesByItemReport({
    reportId,
    needsShopSelector,
    isCanteenReportsPage,
    selectedStall,
    onSelectedStallChange,
    canteenStalls,
    title = "Sales by Item Report",
    filenamePrefix = "SalesByItem",
}: SalesByItemReportProps) {
    const { t } = useTranslation();
    const { user } = useAuth();
    const school = useSchoolInfo();

    const [siDateFrom, setSiDateFrom] = useState("");
    const [siDateTo, setSiDateTo] = useState("");
    const [siUserName, setSiUserName] = useState("");
    const [siCategoryCode, setSiCategoryCode] = useState("");
    const [siItemNoFrom, setSiItemNoFrom] = useState("");
    const [siItemNoTo, setSiItemNoTo] = useState("");
    const [siLoading, setSiLoading] = useState(false);
    const [siData, setSiData] = useState<SalesByItemReportData | null>(null);

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
                // Voided lines don't count toward "best selling" ranking weight.
                const qtyByItem = new Map<string, number>();
                for (const row of data.rows) {
                    if (row.status !== "ACTIVE") continue;
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
            { header: "Seq.", key: "seq", format: "number", align: "right", width: 28 },
            { header: "Date/Time", key: "transaction_date", format: "datetime", width: 95 },
            { header: "Item NO.", key: "item_no", width: 70 },
            { header: "Item Name", key: "item_name", width: 130 },
            { header: "Receipt NO.", key: "receipt_number", width: 85 },
            { header: "ID.", key: "customer_id", width: 68 },
            { header: "Name", key: "customer_name", width: 77 },
            { header: "Sales Qty.", key: "sales_qty", format: "number", align: "right", width: 42 },
            { header: "Sales AMT.", key: "sales_amt", format: "currency", align: "right", width: 60 },
            { header: "Receive Type", key: "receive_type", width: 65 },
            { header: "Remark", key: "remark", width: 60 },
            { header: "Status", key: "status", width: 50 },
        ];
        return {
            meta: {
                title,
                schoolName: school.name,
                schoolLogoUrl: school.logoUrl || undefined,
                reportId,
                filters: buildSalesByItemFilterLines(),
            },
            columns,
            // Exports read item_name directly (no JSX), so bake the bundle suffix
            // into the value itself rather than relying on the table's <span>.
            rows: siData.rows.map((r) => ({
                ...r,
                item_name: r.is_bundle ? `${t("reports.bundleSuffix", " (BUNDLE)")} ${r.item_name}` : r.item_name,
            })) as unknown as Record<string, unknown>[],
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
            const fname = `${filenamePrefix}_${siDateFrom || "any"}_${siDateTo || "any"}.pdf`;
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
            const fname = `${filenamePrefix}_${siDateFrom || "any"}_${siDateTo || "any"}.xlsx`;
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
                        <Package className="h-5 w-5 text-primary" />
                        {title}
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
                                <Select value={selectedStall} onValueChange={onSelectedStallChange}>
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
                                            <th className="px-2 py-2 text-left">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {siData.rows.length === 0 ? (
                                            <tr>
                                                <td colSpan={12} className="px-3 py-4 text-center text-muted-foreground">
                                                    No line items match these filters.
                                                </td>
                                            </tr>
                                        ) : (
                                            siData.rows.map((r) => (
                                                <tr key={r.seq} className={cn("border-t", r.status !== "ACTIVE" && "opacity-60")}>
                                                    <td className="px-2 py-1.5 text-right font-mono">{r.seq}</td>
                                                    <td className="px-2 py-1.5 whitespace-nowrap">{r.transaction_date.slice(0, 19).replace("T", " ")}</td>
                                                    <td className="px-2 py-1.5 font-mono">{r.item_no ?? "—"}</td>
                                                    <td className="px-2 py-1.5">
                                                        {r.item_name}
                                                        {r.is_bundle && (
                                                            <span className="text-muted-foreground">{t("reports.bundleSuffix", " (BUNDLE)")}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-2 py-1.5 font-mono">{r.receipt_number}</td>
                                                    <td className="px-2 py-1.5 font-mono">{r.customer_id ?? "—"}</td>
                                                    <td className="px-2 py-1.5">{r.customer_name ?? "—"}</td>
                                                    <td className="px-2 py-1.5 text-right font-mono">{r.sales_qty}</td>
                                                    <td className="px-2 py-1.5 text-right font-mono">{r.sales_amt.toFixed(2)}</td>
                                                    <td className="px-2 py-1.5">{r.receive_type}</td>
                                                    <td className="px-2 py-1.5 text-muted-foreground">{r.remark ?? ""}</td>
                                                    <td className="px-2 py-1.5">
                                                        {r.status === "ACTIVE" ? (
                                                            <span className="text-muted-foreground">Active</span>
                                                        ) : (
                                                            <span className="font-semibold text-destructive">Voided</span>
                                                        )}
                                                    </td>
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
                                                <td colSpan={3} />
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
