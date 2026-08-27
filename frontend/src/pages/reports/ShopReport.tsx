import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Store, Loader2, FileText, FileSpreadsheet, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { api, ApiError } from "@/lib/api";
import { fmtDateTime, todayBangkok } from "@/lib/dateFormat";
import { useAuth } from "@/contexts/AuthContext";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { exportToPDF, exportToExcel, type ReportPayload } from "@/lib/reportExport";
import { cn } from "@/lib/utils";

// Mirrors backend-bun/src/services/shop_service.ts ShopRow — only the
// directory-relevant fields are declared here (no sales/stock data; this is
// a settings/status directory, not a transactional report).
interface ShopReportRow {
    id: string;
    name: string;
    module: string; // "canteen" | "store"
    is_active: boolean;
    shop_number: number | null;
    allow_topup: boolean;
    edc_card_fee_rate: number;
    uses_dual_pricing: boolean;
    allow_department_charge: boolean;
    created_at: string;
}

type ModuleFilter = "all" | "canteen" | "store";
type StatusFilter = "all" | "active" | "inactive";
type SortKey =
    | "created_at"
    | "id"
    | "name"
    | "module"
    | "is_active"
    | "shop_number"
    | "edc_card_fee_rate";
type SortDir = "asc" | "desc";

/** Generic clickable/sortable <th> — unlike SortableDateTimeHeader (which is
 * hardcoded to a single date/time column with only asc/desc toggling), this
 * one works for any column and shows which of several sortable columns is
 * currently active. */
function SortableHeader({
    label,
    active,
    dir,
    align = "left",
    onClick,
}: {
    label: string;
    active: boolean;
    dir: SortDir;
    align?: "left" | "right";
    onClick: () => void;
}) {
    return (
        <th className={cn("px-2 py-2", align === "right" ? "text-right" : "text-left")}>
            <button
                type="button"
                onClick={onClick}
                className={cn(
                    "inline-flex items-center gap-1 font-medium hover:text-foreground",
                    active ? "text-foreground" : "text-muted-foreground",
                    align === "right" && "flex-row-reverse",
                )}
            >
                {label}
                {active ? (
                    dir === "asc" ? (
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                    )
                ) : (
                    <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" aria-hidden />
                )}
            </button>
        </th>
    );
}

/** Admin/Finance-only directory of all shops across both modules (canteen
 * and store) — name, type, active status, and per-shop settings. Filterable
 * by type/status/name and exportable to PDF/Excel; sortable by clicking any
 * column header. All filtering/sorting happens client-side since the full
 * shop list is small and already loaded in one shot. Lives on /admin/reports
 * (AdminReports.tsx), which already gates access to admin/finance at the
 * route level. */
export function ShopReport() {
    const { user } = useAuth();
    const school = useSchoolInfo();
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [rows, setRows] = useState<ShopReportRow[] | null>(null);

    const [moduleFilter, setModuleFilter] = useState<ModuleFilter>("all");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [searchText, setSearchText] = useState("");
    const [shopIdFilter, setShopIdFilter] = useState("");
    const [sortKey, setSortKey] = useState<SortKey>("created_at");
    const [sortDir, setSortDir] = useState<SortDir>("desc");

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api
            .get<ShopReportRow[]>(`/shops?active_only=false`)
            .then((data) => {
                if (!cancelled) setRows(data);
            })
            .catch((err) => {
                if (cancelled) return;
                const detail = err instanceof ApiError ? err.detail : "Failed to load shops";
                toast.error(detail);
                setRows([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const handleSort = (key: SortKey) => {
        if (key === sortKey) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDir("asc");
        }
    };

    const filteredSortedRows = useMemo(() => {
        if (!rows) return [];
        const search = searchText.trim().toLowerCase();
        const shopId = shopIdFilter.trim().toLowerCase();
        const filtered = rows.filter((r) => {
            if (moduleFilter !== "all" && r.module !== moduleFilter) return false;
            if (statusFilter === "active" && !r.is_active) return false;
            if (statusFilter === "inactive" && r.is_active) return false;
            if (search && !r.name.toLowerCase().includes(search)) return false;
            if (shopId && !r.id.toLowerCase().includes(shopId)) return false;
            return true;
        });

        const dirMul = sortDir === "asc" ? 1 : -1;
        const sorted = [...filtered].sort((a, b) => {
            let cmp = 0;
            switch (sortKey) {
                case "created_at":
                    cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                    break;
                case "id":
                    cmp = a.id.localeCompare(b.id);
                    break;
                case "name":
                    cmp = a.name.localeCompare(b.name);
                    break;
                case "module":
                    cmp = a.module.localeCompare(b.module);
                    break;
                case "is_active":
                    cmp = Number(a.is_active) - Number(b.is_active);
                    break;
                case "shop_number":
                    cmp = (a.shop_number ?? -Infinity) - (b.shop_number ?? -Infinity);
                    break;
                case "edc_card_fee_rate":
                    cmp = a.edc_card_fee_rate - b.edc_card_fee_rate;
                    break;
            }
            return cmp * dirMul;
        });
        return sorted;
    }, [rows, moduleFilter, statusFilter, searchText, shopIdFilter, sortKey, sortDir]);

    const buildFilterLines = (): string[] => {
        const lines: string[] = [];
        if (moduleFilter !== "all") lines.push(`Type: ${moduleFilter === "canteen" ? "Canteen" : "Store"}`);
        if (statusFilter !== "all") lines.push(`Status: ${statusFilter === "active" ? "Active" : "Inactive"}`);
        if (searchText.trim()) lines.push(`Search: ${searchText.trim()}`);
        if (shopIdFilter.trim()) lines.push(`Shop ID: ${shopIdFilter.trim()}`);
        return lines;
    };

    const buildPayload = (): ReportPayload<Record<string, unknown>> => ({
        meta: {
            title: "Shop Report",
            schoolName: school.name,
            schoolLogoUrl: school.logoUrl || undefined,
            reportId: "ISB-ADM-SHOP",
            filters: buildFilterLines(),
            runByName: user?.fullName ?? user?.username,
        },
        columns: [
            { header: "Created Date", key: "created_at", format: "datetime", width: 20 },
            { header: "Shop ID", key: "id", width: 16 },
            { header: "Shop", key: "name", width: 24 },
            { header: "Type", key: "module_label", width: 12 },
            { header: "Status", key: "status_label", width: 10 },
            { header: "Shop No.", key: "shop_number", align: "right", width: 10 },
            { header: "Top-up", key: "topup_label", width: 10 },
            { header: "EDC Fee Rate", key: "edc_fee_label", align: "right", width: 12 },
            { header: "Dual Pricing", key: "dual_pricing_label", width: 12 },
            { header: "Dept. Charge", key: "dept_charge_label", width: 12 },
        ],
        rows: filteredSortedRows.map((r) => ({
            ...r,
            module_label: r.module === "canteen" ? "Canteen" : "Store",
            status_label: r.is_active ? "Active" : "Inactive",
            shop_number: r.shop_number ?? "—",
            topup_label: r.allow_topup ? "Enabled" : "Disabled",
            edc_fee_label: `${r.edc_card_fee_rate.toFixed(2)}%`,
            dual_pricing_label: r.uses_dual_pricing ? "Yes" : "No",
            dept_charge_label: r.allow_department_charge ? "Yes" : "No",
        })) as unknown as Record<string, unknown>[],
    });

    const baseFilename = () => `ShopReport_${todayBangkok().replace(/-/g, "")}`;

    const handleExportPdf = async () => {
        setExporting(true);
        try {
            await exportToPDF(buildPayload(), `${baseFilename()}.pdf`);
        } catch (err) {
            const detail = err instanceof Error ? err.message : "Export failed";
            toast.error(detail);
        } finally {
            setExporting(false);
        }
    };

    const handleExportExcel = () => {
        setExporting(true);
        try {
            exportToExcel(buildPayload(), `${baseFilename()}.xlsx`);
        } catch (err) {
            const detail = err instanceof Error ? err.message : "Export failed";
            toast.error(detail);
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="mt-6 space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Store className="h-5 w-5 text-primary" />
                        Shop Report
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                        All shops (canteen & store) — status and settings
                    </p>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Type</label>
                            <Select value={moduleFilter} onValueChange={(v) => setModuleFilter(v as ModuleFilter)}>
                                <SelectTrigger className="w-[140px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="canteen">Canteen</SelectItem>
                                    <SelectItem value="store">Store</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Status</label>
                            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                                <SelectTrigger className="w-[140px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="active">Active</SelectItem>
                                    <SelectItem value="inactive">Inactive</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Search shop name</label>
                            <Input
                                value={searchText}
                                onChange={(e) => setSearchText(e.target.value)}
                                placeholder="Search…"
                                className="w-[220px]"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Shop ID</label>
                            <Input
                                value={shopIdFilter}
                                onChange={(e) => setShopIdFilter(e.target.value)}
                                placeholder="e.g. canteen1…"
                                className="w-[160px] font-mono"
                            />
                        </div>
                        <div className="flex gap-2 ml-auto">
                            <Button
                                variant="outline"
                                onClick={handleExportPdf}
                                disabled={exporting || loading || filteredSortedRows.length === 0}
                            >
                                {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                                Export PDF
                            </Button>
                            <Button
                                variant="outline"
                                onClick={handleExportExcel}
                                disabled={exporting || loading || filteredSortedRows.length === 0}
                            >
                                <FileSpreadsheet className="h-4 w-4 mr-2" />
                                Export Excel
                            </Button>
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading shops…
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-md border">
                            <table className="w-full text-xs">
                                <thead className="bg-muted/50 whitespace-nowrap">
                                    <tr>
                                        <SortableHeader
                                            label="Created Date"
                                            active={sortKey === "created_at"}
                                            dir={sortDir}
                                            onClick={() => handleSort("created_at")}
                                        />
                                        <SortableHeader
                                            label="Shop ID"
                                            active={sortKey === "id"}
                                            dir={sortDir}
                                            onClick={() => handleSort("id")}
                                        />
                                        <SortableHeader
                                            label="Shop"
                                            active={sortKey === "name"}
                                            dir={sortDir}
                                            onClick={() => handleSort("name")}
                                        />
                                        <SortableHeader
                                            label="Type"
                                            active={sortKey === "module"}
                                            dir={sortDir}
                                            onClick={() => handleSort("module")}
                                        />
                                        <SortableHeader
                                            label="Status"
                                            active={sortKey === "is_active"}
                                            dir={sortDir}
                                            onClick={() => handleSort("is_active")}
                                        />
                                        <SortableHeader
                                            label="Shop No."
                                            active={sortKey === "shop_number"}
                                            dir={sortDir}
                                            align="right"
                                            onClick={() => handleSort("shop_number")}
                                        />
                                        <th className="px-2 py-2 text-left">Top-up</th>
                                        <SortableHeader
                                            label="EDC Fee Rate"
                                            active={sortKey === "edc_card_fee_rate"}
                                            dir={sortDir}
                                            align="right"
                                            onClick={() => handleSort("edc_card_fee_rate")}
                                        />
                                        <th className="px-2 py-2 text-left">Dual Pricing</th>
                                        <th className="px-2 py-2 text-left">Dept. Charge</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredSortedRows.length === 0 ? (
                                        <tr>
                                            <td colSpan={10} className="px-3 py-4 text-center text-muted-foreground">
                                                No shops found.
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredSortedRows.map((r) => (
                                            <tr key={r.id} className="border-t">
                                                <td className="px-2 py-1.5 whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                                                <td className="px-2 py-1.5 font-mono text-muted-foreground">{r.id}</td>
                                                <td className="px-2 py-1.5 font-medium">{r.name}</td>
                                                <td className="px-2 py-1.5 capitalize">{r.module}</td>
                                                <td className="px-2 py-1.5">
                                                    <Badge variant={r.is_active ? "default" : "secondary"} className="text-xs">
                                                        {r.is_active ? "Active" : "Inactive"}
                                                    </Badge>
                                                </td>
                                                <td className="px-2 py-1.5 text-right font-mono">{r.shop_number ?? "—"}</td>
                                                <td className="px-2 py-1.5">{r.allow_topup ? "Enabled" : "Disabled"}</td>
                                                <td className="px-2 py-1.5 text-right font-mono">
                                                    {/* edc_card_fee_rate is stored as a percent value already
                                                        (e.g. 3 means 3%) — see pos_checkout_service.ts's
                                                        `edcCardFeeRate / 100` — not a 0-1 fraction. */}
                                                    {r.edc_card_fee_rate.toFixed(2)}%
                                                </td>
                                                <td className="px-2 py-1.5">{r.uses_dual_pricing ? "Yes" : "No"}</td>
                                                <td className="px-2 py-1.5">{r.allow_department_charge ? "Yes" : "No"}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
