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
import { Receipt, Eye, Download, Loader2, Ban, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import type { TransactionApi, TransactionDetailApi, TransactionListResponse, TransactionStatus } from "./receipts/transactionTypes";
import { ReceiptStatsPanel } from "./receipts/ReceiptStatsPanel";
import { ReceiptSearchPanel } from "./receipts/ReceiptSearchPanel";
import { TransactionSearchPanel } from "./receipts/TransactionSearchPanel";
import { ReceiptVoidDialog } from "./receipts/ReceiptVoidDialog";
import { ReceiptDetailDialog } from "./receipts/ReceiptDetailDialog";
import { UnsuccessfulPanel } from "./receipts/UnsuccessfulPanel";
import { TransactionDetailDialog } from "./receipts/TransactionDetailDialog";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string, _locale?: string): string {
    return fmtDateTimeShared(iso);
}

const PAGE_SIZE = 10;

// ── Component ────────────────────────────────────────────────────────────────

const Receipts = () => {
    const { t } = useTranslation();
    const { user, hasRole } = useAuth();
    // Same gate as the API: carts and payer ids across the whole shop are a
    // manager's business, not a cashier's. Hiding the tab is presentation —
    // the endpoints refuse a cashier regardless.
    const canSeeUnsuccessful = hasRole("manager") || hasRole("admin");
    const isCashier = hasRole("cashier");
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
    const [innerReceiptsTab, setInnerReceiptsTab] = useState<"all" | "unsuccessful">("all");
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
    const [selectedTransaction, setSelectedTransaction] = useState<TransactionDetailApi | null>(null);
    const [isTxnDialogOpen, setIsTxnDialogOpen] = useState(false);
    const [txnCheckLoading, setTxnCheckLoading] = useState(false);
    const [edcVerifyLoading, setEdcVerifyLoading] = useState(false);
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
            // Cashier can only see their own receipts
            if (isCashier && user?.id) {
                params.set("created_by", String(user.id));
            }

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
    }, [queryParams, appliedSearch, currentPage, isCashier, user?.id]);

    useEffect(() => { setCurrentPage(1); }, [queryParams]);

    useEffect(() => { fetchReceipts(); }, [fetchReceipts]);

    const hasActiveSearch =
        appliedSearch.receiptId !== "" ||
        appliedSearch.payer !== "" ||
        appliedSearch.dateFrom !== "" ||
        appliedSearch.dateTo !== "" ||
        appliedSearch.paymentType !== "all";

    // ── Transactions tab — every checkout attempt (pending/success/failed/
    // cancelled) across every payment method, not just completed sales.
    // Reuses `queryParams` above unchanged: same shop scoping as the
    // Receipts tab, since this is the same page just a different view of it.
    const [activeTab, setActiveTab] = useState<"receipts" | "transactions">("receipts");
    const [transactions, setTransactions] = useState<TransactionApi[]>([]);
    const [txnLoading, setTxnLoading] = useState(false);
    const [txnTotal, setTxnTotal] = useState(0);
    const [txnPages, setTxnPages] = useState(1);
    const [txnCurrentPage, setTxnCurrentPage] = useState(1);
    const [txnSortBy, setTxnSortBy] = useState<"created_at" | "resolved_at" | null>(null);
    const [txnSortOrder, setTxnSortOrder] = useState<"asc" | "desc">("desc");

    const [txnSearchDateFrom, setTxnSearchDateFrom] = useState("");
    const [txnSearchDateTo, setTxnSearchDateTo] = useState("");
    const [txnSearchPaymentType, setTxnSearchPaymentType] = useState("all");
    const [txnSearchStatus, setTxnSearchStatus] = useState("all");
    const [txnAppliedSearch, setTxnAppliedSearch] = useState({
        dateFrom: "",
        dateTo: "",
        paymentType: "all",
        status: "all",
    });

    const handleTxnSearch = () => {
        setTxnAppliedSearch({
            dateFrom: txnSearchDateFrom,
            dateTo: txnSearchDateTo,
            paymentType: txnSearchPaymentType,
            status: txnSearchStatus,
        });
        setTxnCurrentPage(1);
    };

    const handleTxnClearSearch = () => {
        setTxnSearchDateFrom("");
        setTxnSearchDateTo("");
        setTxnSearchPaymentType("all");
        setTxnSearchStatus("all");
        setTxnAppliedSearch({ dateFrom: "", dateTo: "", paymentType: "all", status: "all" });
        setTxnCurrentPage(1);
    };

    const hasActiveTxnSearch =
        txnAppliedSearch.dateFrom !== "" ||
        txnAppliedSearch.dateTo !== "" ||
        txnAppliedSearch.paymentType !== "all" ||
        txnAppliedSearch.status !== "all";

    const handleTxnSortChange = (column: "created_at" | "resolved_at") => {
        if (txnSortBy === column) {
            setTxnSortOrder(txnSortOrder === "asc" ? "desc" : "asc");
        } else {
            setTxnSortBy(column);
            setTxnSortOrder("desc");
        }
        setTxnCurrentPage(1);
    };

    const fetchTransactions = useCallback(async () => {
        try {
            setTxnLoading(true);
            const params = new URLSearchParams(queryParams.startsWith("?") ? queryParams.slice(1) : queryParams);
            params.set("page", String(txnCurrentPage));
            params.set("page_size", String(PAGE_SIZE));
            if (txnAppliedSearch.dateFrom) params.set("date_from", txnAppliedSearch.dateFrom);
            if (txnAppliedSearch.dateTo) params.set("date_to", txnAppliedSearch.dateTo);
            if (txnAppliedSearch.paymentType !== "all") params.set("payment_method", txnAppliedSearch.paymentType);
            if (txnAppliedSearch.status !== "all") params.set("status", txnAppliedSearch.status);
            if (txnSortBy) {
                params.set("sort_by", txnSortBy);
                params.set("sort_order", txnSortOrder);
            }
            // Cashier can only see their own transactions
            if (isCashier && user?.id) {
                params.set("created_by", String(user.id));
            }
            const url = `/pos/transactions?${params.toString()}`;
            const data = await api.get<TransactionListResponse>(url);
            setTransactions(data.items);
            setTxnTotal(data.total);
            setTxnPages(data.pages);
        } catch (err) {
            const msg = err instanceof ApiError ? err.message : "Failed to load transactions";
            toast.error(msg);
        } finally {
            setTxnLoading(false);
        }
    }, [queryParams, txnAppliedSearch, txnCurrentPage, txnSortBy, txnSortOrder, isCashier, user?.id]);

    useEffect(() => { setTxnCurrentPage(1); }, [queryParams]);

    // Only fetch once the tab has actually been opened — no need to hit the
    // transactions endpoint for cashiers who never click that tab.
    useEffect(() => {
        if (activeTab === "transactions") fetchTransactions();
    }, [activeTab, fetchTransactions]);

    const txnSafePage = Math.min(txnCurrentPage, txnPages);

    const TXN_STATUS_BADGE: Record<TransactionStatus, "warning" | "success" | "destructive" | "secondary"> = {
        pending: "warning",
        success: "success",
        failed: "destructive",
        cancelled: "secondary",
    };

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

    const handleViewTransaction = async (txn: TransactionApi) => {
        setSelectedTransaction(txn);
        setIsTxnDialogOpen(true);
        try {
            const full = await api.get<TransactionDetailApi>(`/pos/transactions/${txn.id}`);
            setSelectedTransaction(full);
        } catch {
            // fallback — keep the summary row already shown, just no items list
        }
    };

    const handleCheckTransactionNow = async () => {
        if (!selectedTransaction?.ref_code) return;
        setTxnCheckLoading(true);
        try {
            // Same endpoint the QR modal's own background poll uses — asks BAY
            // directly, and updates the row (and creates the receipt) if the
            // bank confirms it went through. This is the only way a stuck
            // 'pending' row can ever resolve once the cashier's screen closed
            // and the webhook never arrived.
            await api.post(`/pos/qr-intent/${selectedTransaction.ref_code}/inquiry`, {});
            const full = await api.get<TransactionDetailApi>(`/pos/transactions/${selectedTransaction.id}`);
            setSelectedTransaction(full);
            setTransactions((prev) => prev.map((t) => (t.id === full.id ? full : t)));
        } catch {
            toast.error(t("receipts.transactions.checkFailed", "Could not check with the bank"));
        } finally {
            setTxnCheckLoading(false);
        }
    };

    const handleVerifyEdcAndCreateReceipt = async () => {
        if (!selectedTransaction?.ref_code) return;
        setEdcVerifyLoading(true);
        try {
            await api.post(`/pos/edc-intent/${selectedTransaction.ref_code}/verify-and-create`, {});
            const full = await api.get<TransactionDetailApi>(`/pos/transactions/${selectedTransaction.id}`);
            setSelectedTransaction(full);
            setTransactions((prev) => prev.map((t) => (t.id === full.id ? full : t)));
            if (full.status === "success") {
                toast.success(t("receipts.transactions.verified", "Payment verified and receipt created"));
            }
        } catch (err) {
            const error = err as ApiError;
            toast.error(error.message || t("receipts.transactions.verifyFailed", "Could not verify EDC payment"));
        } finally {
            setEdcVerifyLoading(false);
        }
    };

    const handleViewReceiptFromTransaction = async (receiptId: number) => {
        setIsTxnDialogOpen(false);
        try {
            const full = await api.get<ReceiptApi>(`/pos/receipt/${receiptId}`);
            setSelectedReceipt(full);
            setIsDialogOpen(true);
        } catch {
            toast.error(t("receipts.transactions.receiptLoadFailed", "Could not load the receipt"));
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
                        {isCashier && (
                            <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
                                Your Receipts
                            </Badge>
                        )}
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

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "receipts" | "transactions")}>
                <TabsList>
                    <TabsTrigger value="receipts" className="gap-2">
                        <Receipt className="h-4 w-4" />
                        {t("receipts.tabReceipts", "Receipts")}
                    </TabsTrigger>
                    <TabsTrigger value="transactions" className="gap-2">
                        <Activity className="h-4 w-4" />
                        {t("receipts.tabTransactions", "Transactions")}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="receipts" className="space-y-4">

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

            {/* The Unsuccessful tab reads a different pair of tables, so the two
                views can never be one query. They do share the date filter above,
                which is the thing a reader compares them by. Hidden entirely from
                cashiers — it exposes carts and payer ids across the whole shop. */}
            <Tabs value={innerReceiptsTab} onValueChange={(v) => setInnerReceiptsTab(v as "all" | "unsuccessful")}>
                {canSeeUnsuccessful && (
                    <TabsList className="mb-3">
                        <TabsTrigger value="all">{t("receipts.allReceipts")}</TabsTrigger>
                        <TabsTrigger value="unsuccessful">
                            {t("receipts.unsuccessful", "Unsuccessful")}
                        </TabsTrigger>
                    </TabsList>
                )}
                <TabsContent value="all">
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
                                    <TableHead className="w-12">Seq.</TableHead>
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
                                {displayRows.map(({ receipt, leg }, idx) => (
                                    <TableRow key={`${receipt.id}-${leg}`} className={leg === "void" ? "bg-destructive/5" : undefined}>
                                        <TableCell className="text-right font-mono text-sm text-muted-foreground">{(receipt as any).seq ?? idx + 1}</TableCell>
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
                </TabsContent>
                {canSeeUnsuccessful && (
                    <TabsContent value="unsuccessful">
                        <UnsuccessfulPanel
                            dateFrom={appliedSearch.dateFrom}
                            dateTo={appliedSearch.dateTo}
                            shopId={user?.shopId ?? null}
                        />
                    </TabsContent>
                )}
            </Tabs>

                </TabsContent>

                <TabsContent value="transactions" className="space-y-4">
                    <InfoCallout
                        id="receipts.transactions.guide"
                        variant="tip"
                        title={t("receipts.transactions.guideTitle", "What is this?")}
                    >
                        {t(
                            "receipts.transactions.guideBody",
                            "Every checkout attempt from the moment a payment method is picked — including ones still pending (e.g. a Thai QR sale waiting for bank confirmation) or that failed before a receipt was created.",
                        )}
                    </InfoCallout>

                    <TransactionSearchPanel
                        searchDateFrom={txnSearchDateFrom}
                        onDateFromChange={setTxnSearchDateFrom}
                        searchDateTo={txnSearchDateTo}
                        onDateToChange={setTxnSearchDateTo}
                        searchPaymentType={txnSearchPaymentType}
                        onPaymentTypeChange={setTxnSearchPaymentType}
                        searchStatus={txnSearchStatus}
                        onStatusChange={setTxnSearchStatus}
                        appliedSearch={txnAppliedSearch}
                        hasActiveSearch={hasActiveTxnSearch}
                        resultsCount={txnTotal}
                        onSearch={handleTxnSearch}
                        onClearSearch={handleTxnClearSearch}
                    />

                    <Card>
                        <CardHeader>
                            <div className="flex items-center">
                                <Activity className="h-6 w-6 mr-2 text-primary" />
                                <CardTitle>{t("receipts.transactions.all", "All Transactions")}</CardTitle>
                                {txnLoading && <Loader2 className="h-4 w-4 ml-2 animate-spin text-muted-foreground" />}
                                {hasActiveTxnSearch && (
                                    <Badge variant="secondary" className="ml-2 text-xs">
                                        {txnTotal}
                                    </Badge>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {txnTotal === 0 && !txnLoading ? (
                                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                    <Activity className="h-10 w-10 mb-3" />
                                    <p>{t("receipts.transactions.none", "No transactions found")}</p>
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-12">Seq.</TableHead>
                                            <TableHead
                                                className="cursor-pointer hover:bg-muted/50 select-none"
                                                onClick={() => handleTxnSortChange("created_at")}
                                            >
                                                {t("receipts.transactions.startedAt", "Start Time")}
                                                {txnSortBy === "created_at" && (
                                                    <span className="ml-1 text-xs">{txnSortOrder === "asc" ? "↑" : "↓"}</span>
                                                )}
                                            </TableHead>
                                            <TableHead
                                                className="cursor-pointer hover:bg-muted/50 select-none"
                                                onClick={() => handleTxnSortChange("resolved_at")}
                                            >
                                                {t("receipts.transactions.endedAt", "End Time")}
                                                {txnSortBy === "resolved_at" && (
                                                    <span className="ml-1 text-xs">{txnSortOrder === "asc" ? "↑" : "↓"}</span>
                                                )}
                                            </TableHead>
                                            {!user?.shopId && (
                                                <TableHead>{t("receipts.shop", "Shop")}</TableHead>
                                            )}
                                            <TableHead>{t("receipts.seller")}</TableHead>
                                            <TableHead>{t("receipts.paymentMethod")}</TableHead>
                                            <TableHead>{t("receipts.buyer")}</TableHead>
                                            <TableHead>{t("receipts.transactions.bankRef", "Bank Ref. No.")}</TableHead>
                                            <TableHead className="text-right">{t("receipts.total")}</TableHead>
                                            <TableHead className="text-center">{t("receipts.transactions.status", "Status")}</TableHead>
                                            <TableHead>{t("receipts.transactions.result", "Result")}</TableHead>
                                            <TableHead className="text-center">{t("receipts.transactions.actions", "Actions")}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {transactions.map((txn, idx) => (
                                            <TableRow key={txn.id}>
                                                <TableCell className="text-right font-mono text-sm text-muted-foreground">{(txn as any).seq ?? (txnSafePage - 1) * PAGE_SIZE + idx + 1}</TableCell>
                                                <TableCell>{fmtDate(txn.created_at)}</TableCell>
                                                <TableCell>
                                                    {txn.resolved_at ? (
                                                        fmtDate(txn.resolved_at)
                                                    ) : (
                                                        <span className="text-xs text-amber-600 italic">
                                                            {t("receipts.transactions.stillWaiting", "Still waiting…")}
                                                        </span>
                                                    )}
                                                </TableCell>
                                                {!user?.shopId && (
                                                    <TableCell className="text-sm">{txn.shop_name ?? txn.shop_id ?? "—"}</TableCell>
                                                )}
                                                <TableCell className="text-sm">{txn.cashier_name ?? "—"}</TableCell>
                                                <TableCell>
                                                    <Badge variant="secondary">
                                                        {formatPaymentMethodLabel(t, txn.payment_method)}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    <div className="flex flex-col">
                                                        <span>{txn.payer_label ?? "—"}</span>
                                                        {txn.payer_code && <span className="text-xs text-muted-foreground">{txn.payer_code}</span>}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {/* The reference tied to the bank/gateway side of the sale —
                                                        BAY's ref_code for Thai QR, the terminal's invoice_no/RRN
                                                        for EDC. Blank for cash/wallet/department, which never
                                                        leave the school's own system. */}
                                                    {txn.ref_code ? (
                                                        <span className="font-mono text-xs">{txn.ref_code}</span>
                                                    ) : (
                                                        "—"
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right font-semibold data-number">
                                                    {txn.amount != null ? `฿${txn.amount.toLocaleString()}` : "—"}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Badge variant={TXN_STATUS_BADGE[txn.status]}>
                                                        {t(`receipts.transactions.status${txn.status.charAt(0).toUpperCase()}${txn.status.slice(1)}`, txn.status)}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {txn.status === "success" && txn.receipt_number ? (
                                                        <span className="font-mono">{txn.receipt_number}</span>
                                                    ) : txn.status === "failed" && txn.error_message ? (
                                                        <span className="text-xs text-destructive italic">{txn.error_message}</span>
                                                    ) : (
                                                        "—"
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <IconButton
                                                        tooltip={t("receipts.tooltip.view")}
                                                        onClick={() => handleViewTransaction(txn)}
                                                    >
                                                        <Eye className="h-4 w-4" />
                                                    </IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}

                            {txnTotal > PAGE_SIZE && (
                                <div className="flex items-center justify-between pt-4 border-t mt-2">
                                    <p className="text-xs text-muted-foreground">
                                        {t("receipts.paginationRange", {
                                            start: (txnSafePage - 1) * PAGE_SIZE + 1,
                                            end: Math.min(txnSafePage * PAGE_SIZE, txnTotal),
                                            total: txnTotal,
                                            defaultValue: "Showing {{start}}–{{end}} of {{total}} items",
                                        })}
                                    </p>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setTxnCurrentPage((p) => Math.max(1, p - 1))}
                                            disabled={txnSafePage === 1 || txnLoading}
                                            className="h-8 px-3 text-xs"
                                        >
                                            {t("receipts.prev", "‹ Prev")}
                                        </Button>
                                        {getPaginationRange(txnSafePage, txnPages).map((p, i) =>
                                            p === "ellipsis" ? (
                                                <span key={`ellipsis-${i}`} className="text-xs px-1 text-muted-foreground">…</span>
                                            ) : (
                                                <Button
                                                    key={p}
                                                    variant={txnSafePage === p ? "default" : "outline"}
                                                    size="sm"
                                                    onClick={() => setTxnCurrentPage(p)}
                                                    disabled={txnLoading}
                                                    className={cn("h-8 w-8 p-0 text-xs", txnSafePage === p && "bg-orange-500 hover:bg-orange-600 border-orange-500")}
                                                >
                                                    {p}
                                                </Button>
                                            ),
                                        )}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setTxnCurrentPage((p) => Math.min(txnPages, p + 1))}
                                            disabled={txnSafePage === txnPages || txnLoading}
                                            className="h-8 px-3 text-xs"
                                        >
                                            {t("receipts.next", "Next ›")}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

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

            <TransactionDetailDialog
                transaction={selectedTransaction}
                open={isTxnDialogOpen}
                onOpenChange={setIsTxnDialogOpen}
                onViewReceipt={handleViewReceiptFromTransaction}
                onCheckNow={handleCheckTransactionNow}
                checking={txnCheckLoading}
                onVerifyEdcAndCreate={handleVerifyEdcAndCreateReceipt}
                verifyingEdc={edcVerifyLoading}
            />
        </div>
    );
};

export default Receipts;
