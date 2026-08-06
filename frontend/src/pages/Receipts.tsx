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
import { formatPaymentMethodLabel } from "@/lib/paymentMethodLabels";
import { downloadReceiptHtml, type ReceiptApi as LibReceiptApi } from "@/lib/printReceipt";
import type { ReceiptApi, ModuleScope, ReceiptListResponse } from "./receipts/receiptTypes";
import { ReceiptStatsPanel } from "./receipts/ReceiptStatsPanel";
import { ReceiptSearchPanel } from "./receipts/ReceiptSearchPanel";
import { ReceiptVoidDialog } from "./receipts/ReceiptVoidDialog";
import { ReceiptDetailDialog } from "./receipts/ReceiptDetailDialog";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string, _locale?: string): string {
    return fmtDateTimeShared(iso);
}

const PAGE_SIZE = 10;

// ── Component ────────────────────────────────────────────────────────────────

const Receipts = () => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const { pathname } = useLocation();
    const schoolInfo = useSchoolInfo();

    const STORE_SHOPS = ["coop", "sports", "bookstore"] as const;
    const CANTEEN_SHOPS = ["canteen", "canteen_thai", "canteen_drinks"] as const;

    const moduleScope: ModuleScope = pathname.startsWith("/canteen")
        ? "canteen"
        : "store";

    const [receipts, setReceipts] = useState<ReceiptApi[]>([]);
    const [loading, setLoading] = useState(true);
    const [totalReceipts, setTotalReceipts] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [listStats, setListStats] = useState<ReceiptListResponse["stats"]>(null);
    const [currentPage, setCurrentPage] = useState(1);

    const [searchReceiptId, setSearchReceiptId] = useState("");
    const [searchPayer, setSearchPayer] = useState("");
    const [searchDateFrom, setSearchDateFrom] = useState("");
    const [searchDateTo, setSearchDateTo] = useState("");
    const [searchPaymentType, setSearchPaymentType] = useState("all");

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
    const [voidTarget, setVoidTarget] = useState<ReceiptApi | null>(null);
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

    const queryParams = useMemo(() => {
        if (moduleScope === "canteen") {
            if (user?.shopId) return `?shop_id=${user.shopId}`;
            if (pickedCanteenShop !== "all") return `?shop_id=${pickedCanteenShop}`;
            const ids = canteenStalls.length > 0
                ? canteenStalls.map((s) => s.id).join(",")
                : CANTEEN_SHOPS.join(",");
            return `?shop_ids=${ids}`;
        }
        if (!user?.shopId) {
            const ids = storeShops.length > 0
                ? storeShops.map((s) => s.id).join(",")
                : STORE_SHOPS.join(",");
            return pickedStoreShop === "all"
                ? `?shop_ids=${ids}`
                : `?shop_id=${pickedStoreShop}`;
        }
        return `?shop_id=${user.shopId}`;
    }, [moduleScope, user, pickedStoreShop, pickedCanteenShop, storeShops, canteenStalls]);

    const fetchReceipts = useCallback(async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams(queryParams.startsWith("?") ? queryParams.slice(1) : queryParams);
            params.set("page", String(currentPage));
            params.set("page_size", String(PAGE_SIZE));
            params.set("include_stats", "1");
            if (appliedSearch.receiptId) params.set("q", appliedSearch.receiptId);
            if (appliedSearch.payer) params.set("payer_q", appliedSearch.payer);
            if (appliedSearch.dateFrom) params.set("date_from", appliedSearch.dateFrom);
            if (appliedSearch.dateTo) params.set("date_to", appliedSearch.dateTo);
            if (appliedSearch.paymentType !== "all") params.set("payment_method", appliedSearch.paymentType);

            const data = await api.get<ReceiptListResponse>(`/pos/receipt?${params.toString()}`);
            setReceipts(data.items);
            setTotalReceipts(data.total);
            setTotalPages(data.pages);
            setListStats(data.stats ?? null);
        } catch (err) {
            const msg = err instanceof ApiError ? err.message : "Failed to load receipts";
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    }, [queryParams, appliedSearch, currentPage]);

    useEffect(() => { setCurrentPage(1); }, [queryParams]);

    useEffect(() => { fetchReceipts(); }, [fetchReceipts]);

    const hasActiveSearch =
        appliedSearch.receiptId !== "" ||
        appliedSearch.payer !== "" ||
        appliedSearch.dateFrom !== "" ||
        appliedSearch.dateTo !== "" ||
        appliedSearch.paymentType !== "all";

    const safePage = Math.min(currentPage, totalPages);

    type ReceiptLeg = { receipt: ReceiptApi; leg: "sale" | "void" };
    const displayRows: ReceiptLeg[] = receipts.flatMap((receipt) =>
        receipt.status === "voided"
            ? [{ receipt, leg: "sale" as const }, { receipt, leg: "void" as const }]
            : [{ receipt, leg: "sale" as const }],
    );

    const todaySales = listStats?.today_active_sales ?? 0;
    const displayMonthlySales = hasActiveSearch
        ? (listStats?.filtered_active_sales ?? 0)
        : (listStats?.month_active_sales ?? 0);
    const displayMonthlyCount = hasActiveSearch
        ? totalReceipts
        : (listStats?.month_receipt_count ?? 0);

    const handleViewReceipt = async (receipt: ReceiptApi) => {
        setSelectedReceipt(receipt);
        setIsDialogOpen(true);
        try {
            const full = await api.get<ReceiptApi>(`/pos/receipt/${receipt.id}`);
            setSelectedReceipt(full);
        } catch {
            // fallback — keep the list data already shown
        }
    };

    if (loading && receipts.length === 0) {
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
                            <Select value={pickedCanteenShop} onValueChange={(v) => { setPickedCanteenShop(v); setCurrentPage(1); }}>
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
                            <Select value={pickedStoreShop} onValueChange={(v) => { setPickedStoreShop(v); setCurrentPage(1); }}>
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
                resultsCount={totalReceipts}
                onSearch={handleSearch}
                onClearSearch={handleClearSearch}
            />

            <Card>
                <CardHeader>
                    <div className="flex items-center">
                        <Receipt className="h-6 w-6 mr-2 text-primary" />
                        <CardTitle>{t("receipts.allReceipts")}</CardTitle>
                        {loading && <Loader2 className="h-4 w-4 ml-2 animate-spin text-muted-foreground" />}
                        {hasActiveSearch && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                                {totalReceipts}
                            </Badge>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    {totalReceipts === 0 && !loading ? (
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
                                {displayRows.map(({ receipt, leg }) => (
                                    <TableRow key={`${receipt.id}-${leg}`} className={leg === "void" ? "bg-destructive/5" : undefined}>
                                        <TableCell className="font-mono text-sm">{receipt.receipt_number}</TableCell>
                                        <TableCell>{fmtDate(leg === "sale" ? receipt.transaction_date : (receipt.voided_at ?? receipt.transaction_date))}</TableCell>
                                        {!user?.shopId && (
                                            <TableCell className="text-sm">{receipt.shop_name ?? receipt.shop_id ?? "—"}</TableCell>
                                        )}
                                        <TableCell className="text-sm">{receipt.created_by_name ?? "—"}</TableCell>
                                        <TableCell>
                                            <Badge variant="secondary">
                                                {formatPaymentMethodLabel(t, receipt.payment_method, {
                                                    edcCardFee: receipt.edc_card_fee,
                                                })}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-sm">{receipt.payer_label ?? "—"}</TableCell>
                                        <TableCell className={cn("text-right font-semibold data-number", leg === "void" && "text-destructive")}>
                                            {leg === "void" ? "-" : ""}฿{receipt.total.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {leg === "sale" ? (
                                                <Badge variant={receipt.status === "active" ? "success" : "secondary"}>
                                                    {t("receipts.statusSale", "Sale")}
                                                </Badge>
                                            ) : (
                                                <Badge variant="destructive">
                                                    {t("receipts.statusVoided")}
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {leg === "sale" ? (
                                                receipt.status !== "active" ? (
                                                    <span className="text-xs text-muted-foreground italic">
                                                        {receipt.voided_reason ?? "—"}
                                                    </span>
                                                ) : (
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
                                                        {canVoid && (
                                                            <IconButton
                                                                tooltip={t("receipts.void", "Void")}
                                                                onClick={() => setVoidTarget(receipt)}
                                                                className="text-destructive hover:text-destructive"
                                                            >
                                                                <Ban className="h-4 w-4" />
                                                            </IconButton>
                                                        )}
                                                    </div>
                                                )
                                            ) : (
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
                                                </div>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}

                    {totalReceipts > PAGE_SIZE && (
                        <div className="flex items-center justify-between pt-4 border-t mt-2">
                            <p className="text-xs text-muted-foreground">
                                {t("receipts.paginationRange", {
                                    start: (safePage - 1) * PAGE_SIZE + 1,
                                    end: Math.min(safePage * PAGE_SIZE, totalReceipts),
                                    total: totalReceipts,
                                    defaultValue: "Showing {{start}}–{{end}} of {{total}} items",
                                })}
                            </p>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage(1)}
                                    disabled={safePage === 1 || loading}
                                    className="h-8 w-8 p-0 text-xs"
                                >
                                    «
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                    disabled={safePage === 1 || loading}
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
                                            disabled={loading}
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
                                    disabled={safePage === totalPages || loading}
                                    className="h-8 px-3 text-xs"
                                >
                                    {t("receipts.next", "Next ›")}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage(totalPages)}
                                    disabled={safePage === totalPages || loading}
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
                onVoided={(updated) => {
                    setReceipts((prev) => prev.map((r) => r.id === updated.id ? updated : r));
                    fetchReceipts();
                }}
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
