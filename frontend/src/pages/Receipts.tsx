import { useState, useEffect, useCallback, useMemo } from "react";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Receipt, Eye, Download, Loader2, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/IconButton";
import { InfoCallout } from "@/components/InfoCallout";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getPaginationRange } from "@/lib/pagination";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { fmtDateTime as fmtDateTimeShared } from "@/lib/dateFormat";
import { downloadReceiptHtml, type ReceiptApi as LibReceiptApi } from "@/lib/printReceipt";
import type { ReceiptApi, ModuleScope } from "./receipts/receiptTypes";
import { ReceiptStatsPanel } from "./receipts/ReceiptStatsPanel";
import { ReceiptSearchPanel } from "./receipts/ReceiptSearchPanel";
import { ReceiptVoidDialog } from "./receipts/ReceiptVoidDialog";
import { ReceiptDetailDialog } from "./receipts/ReceiptDetailDialog";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string, _locale?: string): string {
    return fmtDateTimeShared(iso);
}

function fmtDateOnly(iso: string): string {
    try {
        return new Date(iso).toISOString().slice(0, 10);
    } catch {
        return "";
    }
}

// ── Component ────────────────────────────────────────────────────────────────

const Receipts = () => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const { pathname } = useLocation();
    const schoolInfo = useSchoolInfo();

    // Defined inside component to avoid module-level TDZ issues in bundled output
    const STORE_SHOPS = ["coop", "sports", "bookstore"] as const;
    const CANTEEN_SHOPS = ["canteen", "canteen_thai", "canteen_drinks"] as const;

    // ── Module scope detection (from URL) ───────────────────────────────────
    const moduleScope: ModuleScope = pathname.startsWith("/canteen")
        ? "canteen"
        : "store";

    const [receipts, setReceipts] = useState<ReceiptApi[]>([]);
    const [loading, setLoading] = useState(true);
    const [monthlySales, setMonthlySales] = useState<number>(0);
    const [monthlyCount, setMonthlyCount] = useState<number>(0);

    // ── Structured search fields (inputs) ──────────────────────────────────
    const [searchReceiptId, setSearchReceiptId] = useState("");
    const [searchPayer, setSearchPayer] = useState("");
    const [searchDateFrom, setSearchDateFrom] = useState("");
    const [searchDateTo, setSearchDateTo] = useState("");
    const [searchPaymentType, setSearchPaymentType] = useState("all");

    // Applied criteria — only updated when Search button is clicked
    const [appliedSearch, setAppliedSearch] = useState({
        receiptId: "",
        payer: "",
        dateFrom: "",
        dateTo: "",
        paymentType: "all",
    });

    const handleSearch = () => {
        setAppliedSearch({
            receiptId: searchReceiptId.trim(),
            payer: searchPayer.trim(),
            dateFrom: searchDateFrom,
            dateTo: searchDateTo,
            paymentType: searchPaymentType,
        });
        setCurrentPage(1);
    };

    const handleClearSearch = () => {
        setSearchReceiptId("");
        setSearchPayer("");
        setSearchDateFrom("");
        setSearchDateTo("");
        setSearchPaymentType("all");
        setAppliedSearch({ receiptId: "", payer: "", dateFrom: "", dateTo: "", paymentType: "all" });
        setCurrentPage(1);
    };

    const [selectedReceipt, setSelectedReceipt] = useState<ReceiptApi | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    // ── Void / cancel ───────────────────────────────────────────────────────
    const [voidTarget, setVoidTarget] = useState<ReceiptApi | null>(null);
    // Admin-only picker for store scope (dynamic) / canteen scope (dynamic).
    const [pickedStoreShop, setPickedStoreShop] = useState<string>("all");
    const [pickedCanteenShop, setPickedCanteenShop] = useState<string>("all");
    const [canteenStalls, setCanteenStalls] = useState<{ id: string; name: string }[]>([]);
    const [storeShops, setStoreShops] = useState<{ id: string; name: string }[]>([]);

    const canVoid = user?.role === "admin" || user?.role === "manager" || user?.role === "cashier";

    useEffect(() => {
        if (!user?.shopId) {
            if (moduleScope === "canteen") {
                api.get<{ id: string; name: string }[]>("/shops?module=canteen")
                    .then(setCanteenStalls)
                    .catch(() => { });
            } else {
                api.get<{ id: string; name: string }[]>("/shops?module=store")
                    .then(setStoreShops)
                    .catch(() => { });
            }
        }
    }, [moduleScope, user?.shopId]);

    // ── Build shop-scope query params ───────────────────────────────────────
    const queryParams = useMemo(() => {
        if (moduleScope === "canteen") {
            if (user?.shopId) return `?shop_id=${user.shopId}`;
            if (pickedCanteenShop !== "all") return `?shop_id=${pickedCanteenShop}`;
            return `?shop_ids=${CANTEEN_SHOPS.join(",")}`;
        }
        // Store scope
        if (!user?.shopId) {
            const ids = storeShops.length > 0
                ? storeShops.map((s) => s.id).join(",")
                : STORE_SHOPS.join(",");
            return pickedStoreShop === "all"
                ? `?shop_ids=${ids}`
                : `?shop_id=${pickedStoreShop}`;
        }
        // manager / cashier on store: lock to their own shop
        return `?shop_id=${user.shopId}`;
    }, [moduleScope, user, pickedStoreShop, pickedCanteenShop, storeShops]);

    // ── Fetch receipts from API ─────────────────────────────────────────────
    const fetchReceipts = useCallback(async () => {
        try {
            setLoading(true);
            const data = await api.get<ReceiptApi[]>(`/pos/receipt${queryParams}`);
            setReceipts(data);
        } catch (err) {
            const msg = err instanceof ApiError ? err.message : "Failed to load receipts";
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    }, [queryParams]);

    useEffect(() => { fetchReceipts(); }, [fetchReceipts]);

    // ── Monthly stats fetch (no-filter state) ────────────────────────────────
    const fetchMonthlyStats = useCallback(async () => {
        try {
            const now = new Date();
            // Use local-time dates so Bangkok-timezone users get a full calendar month
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
            const dateFrom = startOfMonth.toISOString();
            const dateTo = endOfToday.toISOString();
            const sep = queryParams.includes("?") ? "&" : "?";
            const params = `${queryParams}${sep}date_from=${dateFrom}&date_to=${dateTo}&page_size=500`;
            const data = await api.get<ReceiptApi[]>(`/pos/receipt${params}`);
            const active = data.filter((r) => r.status === "active");
            setMonthlySales(active.reduce((s, r) => s + r.total, 0));
            setMonthlyCount(data.length);
        } catch {
            // non-critical — leave previous values
        }
    }, [queryParams]);

    useEffect(() => { fetchMonthlyStats(); }, [fetchMonthlyStats]);

    // ── Derived ─────────────────────────────────────────────────────────────
    const filteredReceipts = receipts.filter((r) => {
        const { receiptId, payer, dateFrom, dateTo, paymentType } = appliedSearch;
        if (receiptId && !r.receipt_number.toLowerCase().includes(receiptId.toLowerCase())) return false;
        if (payer) {
            const q = payer.toLowerCase();
            if (!(r.payer_label ?? "").toLowerCase().includes(q)) return false;
        }
        const txDate = fmtDateOnly(r.transaction_date);
        if (dateFrom && txDate < dateFrom) return false;
        if (dateTo && txDate > dateTo) return false;
        if (paymentType !== "all" && r.payment_method.toLowerCase() !== paymentType) return false;
        return true;
    });

    const hasActiveSearch =
        appliedSearch.receiptId !== "" ||
        appliedSearch.payer !== "" ||
        appliedSearch.dateFrom !== "" ||
        appliedSearch.dateTo !== "" ||
        appliedSearch.paymentType !== "all";

    // ── Pagination ──────────────────────────────────────────────────────────
    const PAGE_SIZE = 10;
    const [currentPage, setCurrentPage] = useState(1);

    // Reset to page 1 when search changes
    const totalPages = Math.max(1, Math.ceil(filteredReceipts.length / PAGE_SIZE));
    const safePage = Math.min(currentPage, totalPages);
    const pagedReceipts = filteredReceipts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    const todayStr = new Date().toISOString().slice(0, 10);
    const todaySales = receipts
        .filter((r) => r.status === "active" && fmtDateOnly(r.transaction_date) === todayStr)
        .reduce((s, r) => s + r.total, 0);

    const displayMonthlySales = hasActiveSearch
        ? filteredReceipts.filter((r) => r.status === "active").reduce((s, r) => s + r.total, 0)
        : monthlySales;

    const displayMonthlyCount = hasActiveSearch ? filteredReceipts.length : monthlyCount;

    const handleViewReceipt = async (receipt: ReceiptApi) => {
        // Show immediately with what we have, then enrich with payer_detail from single-receipt endpoint
        setSelectedReceipt(receipt);
        setIsDialogOpen(true);
        try {
            const full = await api.get<ReceiptApi>(`/pos/receipt/${receipt.id}`);
            setSelectedReceipt(full);
        } catch {
            // fallback — keep the list data already shown
        }
    };

    // ── Loading ─────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="page-shell flex items-center justify-center min-h-[50vh]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const scopeTitle =
        moduleScope === "canteen"
            ? t("receipts.canteenTitle", "Canteen Receipts")
            : t("receipts.storeTitle", "Store Receipts");

    return (
        <div className="page-shell">
            <div className="page-header">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="page-title mb-2">{scopeTitle}</h1>
                        <p className="page-description">{t("receipts.description")}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline">
                            {moduleScope === "canteen"
                                ? t("receipts.scopeCanteen")
                                : t("receipts.scopeStore")}
                        </Badge>
                        {moduleScope === "canteen" && !user?.shopId && canteenStalls.length > 0 && (
                            <Select value={pickedCanteenShop} onValueChange={setPickedCanteenShop}>
                                <SelectTrigger className="w-48">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Canteen Shops</SelectItem>
                                    {canteenStalls.map((s) => (
                                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        {moduleScope === "store" && !user?.shopId && storeShops.length > 0 && (
                            <Select value={pickedStoreShop} onValueChange={setPickedStoreShop}>
                                <SelectTrigger className="w-48">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Store Shops</SelectItem>
                                    {storeShops.map((s) => (
                                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                </div>
            </div>

            <InfoCallout
                id="receipts.statusGuide"
                variant="tip"
                title={t("receipts.info.statusGuide.title")}
            >
                {t("receipts.info.statusGuide.body")}
            </InfoCallout>

            <ReceiptStatsPanel
                todaySales={todaySales}
                displayMonthlySales={displayMonthlySales}
                displayMonthlyCount={displayMonthlyCount}
            />

            <ReceiptSearchPanel
                searchReceiptId={searchReceiptId}
                onReceiptIdChange={setSearchReceiptId}
                searchPayer={searchPayer}
                onPayerChange={setSearchPayer}
                searchDateFrom={searchDateFrom}
                onDateFromChange={setSearchDateFrom}
                searchDateTo={searchDateTo}
                onDateToChange={setSearchDateTo}
                searchPaymentType={searchPaymentType}
                onPaymentTypeChange={setSearchPaymentType}
                appliedSearch={appliedSearch}
                hasActiveSearch={hasActiveSearch}
                resultsCount={filteredReceipts.length}
                onSearch={handleSearch}
                onClearSearch={handleClearSearch}
            />

            {/* Receipts List */}
            <Card>
                <CardHeader>
                    <div className="flex items-center">
                        <Receipt className="h-6 w-6 mr-2 text-primary" />
                        <CardTitle>{t("receipts.allReceipts")}</CardTitle>
                        {hasActiveSearch && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                                {filteredReceipts.length} / {receipts.length}
                            </Badge>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    {filteredReceipts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                            <Receipt className="h-10 w-10 mb-3" />
                            <p>{t("receipts.noReceipts")}</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("receipts.receiptId")}</TableHead>
                                    <TableHead>{t("receipts.dateTime")}</TableHead>
                                    {!user?.shopId && (
                                        <TableHead>{t("receipts.shop", "Shop")}</TableHead>
                                    )}
                                    <TableHead>{t("receipts.seller")}</TableHead>
                                    <TableHead>{t("receipts.paymentMethod")}</TableHead>
                                    <TableHead>{t("receipts.buyer")}</TableHead>
                                    <TableHead className="text-right">{t("receipts.total")}</TableHead>
                                    <TableHead className="text-center">{t("receipts.status")}</TableHead>
                                    <TableHead className="text-center">{t("receipts.manage")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pagedReceipts.map((receipt) => (
                                    <TableRow key={receipt.id}>
                                        <TableCell className="font-mono text-sm">{receipt.receipt_number}</TableCell>
                                        <TableCell>{fmtDate(receipt.transaction_date)}</TableCell>
                                        {!user?.shopId && (
                                            <TableCell className="text-sm">{receipt.shop_name ?? receipt.shop_id ?? "—"}</TableCell>
                                        )}
                                        <TableCell className="text-sm">{receipt.created_by_name ?? "—"}</TableCell>
                                        <TableCell>
                                            <Badge variant="secondary">
                                                {t(`common.paymentMethods.${(receipt.payment_method ?? "").toLowerCase()}`, receipt.payment_method)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-sm">{receipt.payer_label ?? "—"}</TableCell>
                                        <TableCell className="text-right font-semibold data-number">
                                            ฿{receipt.total.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant={receipt.status === "active" ? "success" : "destructive"}>
                                                {receipt.status === "active"
                                                    ? t("receipts.statusActive")
                                                    : t("receipts.statusVoided")}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <div className="flex gap-2 justify-center">
                                                <IconButton
                                                    tooltip={t("receipts.tooltip.view")}
                                                    onClick={() => handleViewReceipt(receipt)}
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </IconButton>
                                                <IconButton
                                                    tooltip={t("receipts.tooltip.download")}
                                                    onClick={() => downloadReceiptHtml(receipt as unknown as LibReceiptApi, schoolInfo, receipt.shop_name ?? user?.shopName, "en")}
                                                >
                                                    <Download className="h-4 w-4" />
                                                </IconButton>
                                                {canVoid && receipt.status === "active" && (
                                                    <IconButton
                                                        tooltip={t("receipts.void", "Void")}
                                                        onClick={() => setVoidTarget(receipt)}
                                                        className="text-destructive hover:text-destructive"
                                                    >
                                                        <Ban className="h-4 w-4" />
                                                    </IconButton>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}

                    {/* ── Pagination ────────────────────────────────────────────────── */}
                    {filteredReceipts.length > PAGE_SIZE && (
                        <div className="flex items-center justify-between pt-4 border-t mt-2">
                            <p className="text-xs text-muted-foreground">
                                {t("receipts.paginationRange", {
                                    start: (safePage - 1) * PAGE_SIZE + 1,
                                    end: Math.min(safePage * PAGE_SIZE, filteredReceipts.length),
                                    total: filteredReceipts.length,
                                    defaultValue: "Showing {{start}}–{{end}} of {{total}} items",
                                })}
                            </p>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage(1)}
                                    disabled={safePage === 1}
                                    className="h-8 w-8 p-0 text-xs"
                                >
                                    «
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                    disabled={safePage === 1}
                                    className="h-8 px-3 text-xs"
                                >
                                    {t("receipts.prev", "‹ Prev")}
                                </Button>
                                {getPaginationRange(safePage, totalPages).map((p, i) =>
                                    p === "ellipsis" ? (
                                        <span key={`ellipsis-${i}`} className="text-xs px-1 text-muted-foreground">…</span>
                                    ) : (
                                        <Button
                                            key={p}
                                            variant={safePage === p ? "default" : "outline"}
                                            size="sm"
                                            onClick={() => setCurrentPage(p)}
                                            className={cn("h-8 w-8 p-0 text-xs", safePage === p && "bg-orange-500 hover:bg-orange-600 border-orange-500")}
                                        >
                                            {p}
                                        </Button>
                                    ),
                                )}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                    disabled={safePage === totalPages}
                                    className="h-8 px-3 text-xs"
                                >
                                    {t("receipts.next", "Next ›")}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage(totalPages)}
                                    disabled={safePage === totalPages}
                                    className="h-8 w-8 p-0 text-xs"
                                >
                                    »
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <ReceiptVoidDialog
                receipt={voidTarget}
                onOpenChange={(open) => { if (!open) setVoidTarget(null); }}
                onVoided={(updated) => setReceipts((prev) => prev.map((r) => r.id === updated.id ? updated : r))}
                moduleScope={moduleScope}
                pickedCanteenShop={pickedCanteenShop}
                pickedStoreShop={pickedStoreShop}
            />

            <ReceiptDetailDialog
                receipt={selectedReceipt}
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
            />
        </div>
    );
};

export default Receipts;
