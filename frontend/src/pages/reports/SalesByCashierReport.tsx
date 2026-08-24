import { Fragment, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { FileSpreadsheet, FileText, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { todayBangkok } from "@/lib/dateFormat";
import { formatAggregatedPaymentMethodLabelPlain } from "@/lib/paymentMethodLabels";
import {
    exportToPDF,
    exportToExcel,
    buildDateFilterLine,
    sanitizeFilename,
    SECTION_KEY,
    EMPHASIS_KEY,
    type ReportColumn,
    type ReportPayload,
} from "@/lib/reportExport";
import type { CanteenShop } from "./reportHelpers";

interface SalesByCashierRow {
    cashier_id: number;
    cashier_name: string;
    payment_method: string;
    receipt_count: number;
    total: number;
    edc_card_fee: number;
    shop_id: string;
    shop_name: string | null;
    status: string;
}

interface SalesByCashierReportData {
    date_from: string;
    date_to: string;
    shop_id: string | null;
    rows: SalesByCashierRow[];
    grand_total: number;
    total_receipts: number;
    own_sales_only: boolean;
}

interface MethodAgg { receipt_count: number; total: number }
interface CashierGroup {
    cashier_id: number;
    cashier_name: string;
    methods: Array<{ label: string } & MethodAgg>;
    receipt_count: number;
    total: number;
}

/** Group flat rows by cashier, then by payment-method label within each. */
function groupByCashier(rows: SalesByCashierRow[]): CashierGroup[] {
    const byCashier = new Map<number, { name: string; rows: SalesByCashierRow[] }>();
    for (const r of rows) {
        const e = byCashier.get(r.cashier_id);
        if (e) e.rows.push(r);
        else byCashier.set(r.cashier_id, { name: r.cashier_name, rows: [r] });
    }
    const groups: CashierGroup[] = [];
    for (const [cashier_id, { name, rows: cashierRows }] of byCashier) {
        const byMethod = new Map<string, MethodAgg>();
        for (const r of cashierRows) {
            const label = formatAggregatedPaymentMethodLabelPlain(r.payment_method, r.edc_card_fee);
            const cur = byMethod.get(label) ?? { receipt_count: 0, total: 0 };
            cur.receipt_count += r.receipt_count;
            cur.total += r.total;
            byMethod.set(label, cur);
        }
        const methods = [...byMethod.entries()].map(([label, v]) => ({ label, ...v }));
        groups.push({
            cashier_id,
            cashier_name: name,
            methods,
            receipt_count: methods.reduce((s, m) => s + m.receipt_count, 0),
            total: methods.reduce((s, m) => s + m.total, 0),
        });
    }
    groups.sort((a, b) => b.total - a.total);
    return groups;
}

interface SalesByCashierReportProps {
    reportId: string;
    needsShopSelector: boolean;
    isCanteenReportsPage: boolean;
    selectedStall: string;
    onSelectedStallChange: (v: string) => void;
    canteenStalls: CanteenShop[];
}

export function SalesByCashierReport({
    reportId,
    needsShopSelector,
    isCanteenReportsPage,
    selectedStall,
    onSelectedStallChange,
    canteenStalls,
}: SalesByCashierReportProps) {
    const { user } = useAuth();
    const school = useSchoolInfo();

    // Defaults to today — this report is meant as a same-day shift/EOD
    // summary, not an ad-hoc historical query like the other reports here.
    const [scDateFrom, setScDateFrom] = useState(todayBangkok());
    const [scDateTo, setScDateTo] = useState(todayBangkok());
    const [scLoading, setScLoading] = useState(false);
    const [scData, setScData] = useState<SalesByCashierReportData | null>(null);

    const scGroups = scData ? groupByCashier(scData.rows) : [];

    const buildQuery = (): string => {
        const params = new URLSearchParams();
        params.set("date_from", scDateFrom);
        params.set("date_to", scDateTo);
        if (needsShopSelector) {
            if (selectedStall === "all") params.set("module", isCanteenReportsPage ? "canteen" : "store");
            else params.set("shop_id", selectedStall);
        } else if (user?.shopId) {
            params.set("shop_id", user.shopId);
        }
        return params.toString();
    };

    const handleLoad = async () => {
        if (!scDateFrom || !scDateTo) {
            toast.error("Select a date range first.");
            return;
        }
        setScLoading(true);
        try {
            const qs = buildQuery();
            const data = await api.get<SalesByCashierReportData>(
                `/reports/sales-by-cashier${qs ? `?${qs}` : ""}`,
            );
            setScData(data);
            if (data.rows.length === 0) toast.message("No sales match these filters.");
        } catch (err) {
            const detail = err instanceof ApiError ? err.detail : "Something went wrong loading this report.";
            toast.error(detail);
        } finally {
            setScLoading(false);
        }
    };

    const buildFilterLines = (): string[] => {
        const lines: string[] = [];
        const dateLine = buildDateFilterLine("Date", scDateFrom, scDateTo);
        if (dateLine) lines.push(dateLine);
        if (needsShopSelector && selectedStall !== "all") {
            const stall = canteenStalls.find((s) => s.id === selectedStall);
            if (stall) lines.push(`Shop: ${stall.name}`);
        }
        return lines;
    };

    const buildPayload = (): ReportPayload<Record<string, unknown>> | null => {
        if (!scData) return null;

        const bodyRows: Record<string, unknown>[] = [];
        for (const g of scGroups) {
            bodyRows.push({ [SECTION_KEY]: g.cashier_name });
            for (const m of g.methods) {
                bodyRows.push({ cashier_name: g.cashier_name, payment_method: m.label, receipt_count: m.receipt_count, total: m.total });
            }
            bodyRows.push({
                [EMPHASIS_KEY]: "subtotal" as const,
                payment_method: `Total (${g.receipt_count})`,
                total: g.total,
            });
        }

        const columns: ReportColumn[] = [
            { header: "Cashier", key: "cashier_name", width: 25 },
            { header: "Payment Method", key: "payment_method", width: 25 },
            { header: "Receipt Count", key: "receipt_count", format: "number", align: "right", width: 15 },
            { header: "Total", key: "total", format: "currency", align: "right", width: 15 },
        ];

        return {
            meta: {
                title: "Today's Sale Report",
                schoolName: school.name,
                schoolLogoUrl: school.logoUrl || undefined,
                reportId,
                filters: buildFilterLines(),
                runByName: user?.fullName ?? user?.username,
            },
            columns,
            rows: bodyRows,
            totals: { total: scData.grand_total },
        };
    };

    const handleExportPdf = async () => {
        const payload = buildPayload();
        if (!payload) return;
        try {
            const fname = `${sanitizeFilename("TodaysSaleReport")}_${sanitizeFilename(scDateFrom)}_${sanitizeFilename(scDateTo)}.pdf`;
            await exportToPDF(payload, fname);
            toast.success("Exported.");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Export failed.");
        }
    };

    const handleExportExcel = () => {
        const payload = buildPayload();
        if (!payload) return;
        try {
            const fname = `${sanitizeFilename("TodaysSaleReport")}_${sanitizeFilename(scDateFrom)}_${sanitizeFilename(scDateTo)}.xlsx`;
            exportToExcel(payload, fname);
            toast.success("Exported.");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Export failed.");
        }
    };

    return (
        <div className="mt-6 space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary" />
                        Today's Sale Report
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                        {scData?.own_sales_only
                            ? "Showing your own sales only."
                            : "Sales broken down by cashier, with a payment-method breakdown per cashier."}
                    </p>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="space-y-2 md:col-span-2 lg:col-span-2">
                            <Label>Date Range</Label>
                            <DateRangePicker
                                id="scDateRange"
                                startDate={scDateFrom}
                                endDate={scDateTo}
                                onStartChange={setScDateFrom}
                                onEndChange={setScDateTo}
                            />
                        </div>
                        {needsShopSelector && (
                            <div className="space-y-2">
                                <Label htmlFor="scShop">Shop</Label>
                                <Select value={selectedStall} onValueChange={onSelectedStallChange}>
                                    <SelectTrigger id="scShop"><SelectValue /></SelectTrigger>
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

                    <div className="flex flex-wrap items-center gap-2">
                        <Button onClick={handleLoad} disabled={scLoading}>
                            {scLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            Search
                        </Button>
                        {scData && (
                            <>
                                <Button variant="outline" onClick={handleExportPdf}>
                                    <FileText className="h-4 w-4 mr-2" />
                                    Export PDF
                                </Button>
                                <Button variant="outline" onClick={handleExportExcel}>
                                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                                    Export Excel
                                </Button>
                            </>
                        )}
                    </div>

                    {scData && (
                        <div className="space-y-3">
                            <div className="text-sm text-muted-foreground">
                                <span className="font-semibold text-foreground">{scData.total_receipts}</span> receipts
                                {" · "}Grand Total{" "}
                                <span className="font-semibold text-foreground">
                                    ฿{scData.grand_total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                                </span>
                            </div>
                            <div className="overflow-x-auto rounded-md border">
                                <table className="w-full text-xs">
                                    <thead className="bg-muted/50 whitespace-nowrap">
                                        <tr>
                                            <th className="px-2 py-2 text-left">Cashier / Payment Method</th>
                                            <th className="px-2 py-2 text-right">Receipt Count</th>
                                            <th className="px-2 py-2 text-right">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {scGroups.length === 0 ? (
                                            <tr>
                                                <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">
                                                    No sales match these filters.
                                                </td>
                                            </tr>
                                        ) : (
                                            scGroups.map((g) => (
                                                <Fragment key={g.cashier_id}>
                                                    <tr className="border-t bg-muted/30">
                                                        <td colSpan={3} className="px-2 py-1.5 font-semibold">{g.cashier_name}</td>
                                                    </tr>
                                                    {g.methods.map((m) => (
                                                        <tr key={m.label} className="border-t">
                                                            <td className="px-2 py-1.5 pl-6 text-muted-foreground">{m.label}</td>
                                                            <td className="px-2 py-1.5 text-right font-mono">{m.receipt_count}</td>
                                                            <td className="px-2 py-1.5 text-right font-mono">{m.total.toFixed(2)}</td>
                                                        </tr>
                                                    ))}
                                                    <tr className="border-t font-semibold">
                                                        <td className="px-2 py-1.5 pl-6">Subtotal ({g.receipt_count})</td>
                                                        <td />
                                                        <td className="px-2 py-1.5 text-right font-mono">{g.total.toFixed(2)}</td>
                                                    </tr>
                                                </Fragment>
                                            ))
                                        )}
                                    </tbody>
                                    {scGroups.length > 0 && (
                                        <tfoot className="bg-muted/30 font-semibold whitespace-nowrap">
                                            <tr className="border-t">
                                                <td className="px-2 py-2 text-left">TOTAL ({scData.total_receipts})</td>
                                                <td />
                                                <td className="px-2 py-2 text-right font-mono">{scData.grand_total.toFixed(2)}</td>
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
