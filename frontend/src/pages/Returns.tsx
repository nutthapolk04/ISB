import { useState, useEffect, useCallback } from "react";
import { useRfidInput } from "@/hooks/useRfidInput";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, Search, Calendar, Package, Printer, ArrowLeftRight } from "lucide-react";
import { InfoCallout } from "@/components/InfoCallout";
import { toast } from "@/components/ui/sonner";
import { fmtDateTime } from "@/lib/dateFormat";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { printReturnSlip } from "@/lib/printReturnSlip";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type {
    Receipt,
    ReceiptItem,
    PosReceipt,
    ReturnRequest,
    ReturnMode,
    ReturnResult,
    SelectedItemsMap,
    ExchangeItemsMap,
} from "./returns/returnsTypes";
import { itemKey, getPaymentMethodLabel, buildReturnItems, buildExchangeItems } from "./returns/returnsHelpers";
import { NoReceiptReturnPanel } from "./returns/NoReceiptReturnPanel";
import { ReceiptSearchPanel } from "./returns/ReceiptSearchPanel";
import { ReturnHistoryTable } from "./returns/ReturnHistoryTable";
import { RefundConfirmDialog } from "./returns/RefundConfirmDialog";
import { CardTapDialog } from "./returns/CardTapDialog";
import { EditReturnDialog } from "./returns/EditReturnDialog";

const Returns = () => {
    const { t, i18n } = useTranslation();
    const schoolInfo = useSchoolInfo();
    const [returns, setReturns] = useState<ReturnRequest[]>([]);
    const [availableProducts, setAvailableProducts] = useState<ReceiptItem[]>([]);

    // ── Return mode toggle ─────────────────────────────────────────────────────
    const [returnMode, setReturnMode] = useState<ReturnMode>("with-receipt");

    // ── Load data from API ──────────────────────────────────────────────────
    const fetchReturns = useCallback(async () => {
        try {
            const data = await api.get<ReturnRequest[]>("/returns");
            setReturns(data);
        } catch { /* silent */ }
    }, []);

    const [currentShopId, setCurrentShopId] = useState<string | null>(null);

    const fetchAvailableProducts = useCallback(async (shopId?: string | null) => {
        try {
            const params = new URLSearchParams({ inStock: "false" });
            if (shopId) params.set("shop_id", shopId);
            const data = await api.get<{ productCode: string; productName: string; quantity: number; price: number }[]>(`/exchange/products?${params}`);
            setAvailableProducts(data);
        } catch { /* silent */ }
    }, []);

    // ── Today's receipts ──────────────────────────────────────────────────
    const [posReceipts, setPosReceipts] = useState<PosReceipt[]>([]);
    const [posReceiptsLoading, setPosReceiptsLoading] = useState(false);
    const [receiptSearchTerm, setReceiptSearchTerm] = useState("");

    const loadPosReceipts = useCallback(async (q?: string) => {
        setPosReceiptsLoading(true);
        try {
            const params = new URLSearchParams({ page: "1", page_size: "100" });
            if (q) params.set("q", q);
            const data = await api.get<PosReceipt[]>(`/pos/receipt?${params}`);
            setPosReceipts(data);
        } catch { /* silent */ } finally {
            setPosReceiptsLoading(false);
        }
    }, []);

    const todayIso = new Date().toISOString().slice(0, 10);
    const displayedReceipts = receiptSearchTerm.trim()
        ? posReceipts
        : posReceipts.filter((r) => r.transaction_date?.startsWith(todayIso));

    const handleStartReturn = async (receiptNumber: string, intent: "refund" | "exchange" = "refund") => {
        setReturnMode("with-receipt");
        setSearchReceiptId(receiptNumber);
        setSearchStudent("");
        setSearchDateFrom("");
        setSearchDateTo("");
        setSearchPaymentMethod("all");
        setTransactionType(intent);
        try {
            const data = await api.get<{ receipt?: Receipt & { shopId?: string } }>(
                `/receipts/search?receiptId=${encodeURIComponent(receiptNumber)}`
            );
            if (data.receipt) {
                setSelectedReceipt(data.receipt);
                setSelectedItems({});
                setReason("");
                const shopId = (data.receipt as any).shopId;
                setCurrentShopId(shopId ?? null);
                fetchAvailableProducts(shopId);
                try {
                    const existingData = await api.get<ReturnRequest[]>(
                        `/returns/by-receipt?receiptId=${encodeURIComponent(data.receipt.id)}`
                    );
                    setExistingReturns(existingData);
                } catch { setExistingReturns([]); }
                // Scroll to search/return section
                window.scrollTo({ top: 0, behavior: "smooth" });
            } else {
                toast.error(t("returns.receiptNotFound"));
            }
        } catch {
            toast.error(t("returns.receiptNotFound"));
        }
    };

    useEffect(() => { fetchReturns(); loadPosReceipts(); }, [fetchReturns, loadPosReceipts]);

    // Existing returns for the searched receipt (to show returnable vs already-returned)
    const [existingReturns, setExistingReturns] = useState<ReturnRequest[]>([]);

    // Duplicate conflict modal
    const [isDuplicateDialogOpen, setIsDuplicateDialogOpen] = useState(false);
    const [duplicateConflicts, setDuplicateConflicts] = useState<ReturnRequest[]>([]);

    // Search states
    const [searchReceiptId, setSearchReceiptId] = useState("");
    const [searchDateFrom, setSearchDateFrom] = useState("");
    const [searchDateTo, setSearchDateTo] = useState("");
    const [searchPaymentMethod, setSearchPaymentMethod] = useState<string>("all");
    const [searchStudent, setSearchStudent] = useState("");
    const [deleteReturn, setDeleteReturn] = useState<ReturnRequest | null>(null);

    // Selected receipt
    const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);

    // Multi-match results (when search returns >1 receipts — user picks one)
    const [searchResults, setSearchResults] = useState<(Receipt & { shopId?: string })[]>([]);

    // Return form states
    // Key = `${productCode}::${bundleId ?? 0}` so a bundle line and a regular
    // line that share the same anchor product code can coexist on one receipt
    // without their selections / quantities colliding.
    const [selectedItems, setSelectedItems] = useState<SelectedItemsMap>({});
    const [reason, setReason] = useState("");

    // Edit dialog states
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [editingReturn, setEditingReturn] = useState<ReturnRequest | null>(null);
    const [editReason, setEditReason] = useState("");

    // View receipt dialog states
    const [isViewReceiptDialogOpen, setIsViewReceiptDialogOpen] = useState(false);
    const [viewingReceipt, setViewingReceipt] = useState<Receipt | null>(null);

    // Exchange product states
    const [exchangeItems, setExchangeItems] = useState<ExchangeItemsMap>({});
    const [selectedExchangeProduct, setSelectedExchangeProduct] = useState<string>("");
    const [selectedExchangeQuantity, setSelectedExchangeQuantity] = useState<string>("1");

    // Card tap confirmation dialog states
    const [isCardTapDialogOpen, setIsCardTapDialogOpen] = useState(false);
    const [cardTapStep, setCardTapStep] = useState<"input" | "processing" | "success">("input");
    const [transactionType, setTransactionType] = useState<"refund" | "exchange">("refund");
    const [cardLookupError, setCardLookupError] = useState<string | null>(null);
    const [verifiedCardholder, setVerifiedCardholder] = useState<{
        full_name: string;
        customer_code?: string;
    } | null>(null);

    // Refund confirmation dialog — destination is derived from the original
    // receipt (which wallet / card / cash paid). No more method picker.
    const [isRefundConfirmOpen, setIsRefundConfirmOpen] = useState(false);

    // Credit note result dialog — shown after a successful refund
    const [returnResult, setReturnResult] = useState<ReturnResult | null>(null);
    const [isCreditNoteDialogOpen, setIsCreditNoteDialogOpen] = useState(false);

    const pickSearchResult = async (receipt: Receipt & { shopId?: string }) => {
        setSelectedReceipt(receipt);
        setSearchResults([]);
        setSelectedItems({});
        setReason("");
        const shopId = (receipt as any).shopId;
        setCurrentShopId(shopId ?? null);
        fetchAvailableProducts(shopId);
        try {
            const existingData = await api.get<ReturnRequest[]>(
                `/returns/by-receipt?receiptId=${encodeURIComponent(receipt.id)}`
            );
            setExistingReturns(existingData);
        } catch {
            setExistingReturns([]);
        }
        toast.success(t('returns.receiptFound') + ": " + receipt.id);
    };

    const handleSearchReceipt = async () => {
        if (!searchReceiptId && !searchDateFrom && !searchDateTo && searchPaymentMethod === "all" && !searchStudent) {
            toast.error(t('returns.errorPleaseEnterCriteria'));
            return;
        }

        try {
            const params = new URLSearchParams();
            if (searchReceiptId) params.set("receiptId", searchReceiptId);
            if (searchStudent) params.set("studentCode", searchStudent);
            if (searchDateFrom) params.set("dateFrom", searchDateFrom);
            if (searchDateTo) params.set("dateTo", searchDateTo);
            if (searchPaymentMethod && searchPaymentMethod !== "all") params.set("paymentMethod", searchPaymentMethod);

            const data = await api.get<{
                receipts: (Receipt & { shopId?: string })[];
                receipt?: Receipt & { shopId?: string };
            }>(`/receipts/search?${params}`);

            const results = data.receipts ?? (data.receipt ? [data.receipt] : []);
            if (results.length === 0) {
                setSelectedReceipt(null);
                setSearchResults([]);
                setExistingReturns([]);
                toast.error(t('returns.receiptNotFound'));
            } else if (results.length === 1) {
                await pickSearchResult(results[0]);
            } else {
                setSelectedReceipt(null);
                setExistingReturns([]);
                setSearchResults(results);
                toast.success(t('returns.multipleResults', { count: results.length }));
            }
        } catch {
            setSelectedReceipt(null);
            setSearchResults([]);
            setExistingReturns([]);
            toast.error(t('returns.receiptNotFound'));
        }
    };

    const handleItemSelect = (item: ReceiptItem, isSelected: boolean, _maxQty: number) => {
        const k = itemKey(item);
        setSelectedItems((prev) => ({
            ...prev,
            [k]: {
                selected: isSelected,
                returnQty: isSelected ? 1 : 0,
                productCode: item.productCode,
                bundleId: item.bundleId ?? null,
            },
        }));
    };

    const handleQuantityChange = (item: ReceiptItem, qty: number, maxQty: number) => {
        if (qty < 1 || qty > maxQty) return;
        const k = itemKey(item);
        setSelectedItems((prev) => ({
            ...prev,
            [k]: {
                ...prev[k],
                returnQty: qty,
            },
        }));
    };

    const handleSubmitReturn = async () => {
        if (!selectedReceipt) {
            toast.error(t('returns.errorSearchReceipt'));
            return;
        }

        const selectedProducts = Object.entries(selectedItems).filter(([_, data]) => data.selected);

        if (selectedProducts.length === 0) {
            toast.error(t('returns.errorSelectProducts'));
            return;
        }

        if (!reason.trim()) {
            toast.error(t('returns.errorEnterReason'));
            return;
        }

        const items = selectedProducts.map(([_k, data]) => {
            const item = selectedReceipt.items.find(
                (i: ReceiptItem) =>
                    i.productCode === data.productCode &&
                    (i.bundleId ?? null) === data.bundleId,
            );
            return {
                productCode: data.productCode,
                productName: item?.productName ?? data.productCode,
                quantity: item?.quantity ?? data.returnQty,
                returnQuantity: data.returnQty,
                price: item?.price ?? 0,
                bundleId: data.bundleId,
            };
        });

        try {
            const created = await api.post<ReturnRequest[]>("/returns/create", {
                receiptId: selectedReceipt.id,
                items,
                reason: reason.trim(),
            });
            // Auto-approve immediately — no separate manager approval needed
            if (Array.isArray(created)) {
                await Promise.all(
                    created.map((r) => api.put(`/returns/${r.id}`, { status: "approved" }).catch(() => { }))
                );
            }
            toast.success(t('returns.returnSuccess', 'คืนสินค้าสำเร็จ'));
            await fetchReturns();

            // Reset form
            setSelectedReceipt(null);
            setExistingReturns([]);
            setSelectedItems({});
            setReason("");
            setSearchReceiptId("");
            setSearchDateFrom("");
            setSearchDateTo("");
            setSearchPaymentMethod("all");
            setSearchStudent("");
        } catch (err: any) {
            if (err?.status === 409) {
                // Show modal with conflicting items
                setDuplicateConflicts(existingReturns.filter(r =>
                    Object.values(selectedItems).some(sel =>
                        sel.selected &&
                        sel.productCode === r.productCode &&
                        (sel.bundleId ?? null) === (r.bundleId ?? null)
                    )
                ));
                setIsDuplicateDialogOpen(true);
                // Re-fetch existing returns to update the table
                try {
                    const freshData = await api.get<ReturnRequest[]>(
                        `/returns/by-receipt?receiptId=${encodeURIComponent(selectedReceipt!.id)}`
                    );
                    setExistingReturns(freshData);
                } catch { /* silent */ }
            } else {
                toast.error(err?.detail || err?.message || "Failed to create return");
            }
        }
    };


    const handleViewReceipt = async (receiptId: string) => {
        try {
            const data = await api.get<{ receipt?: Receipt }>(`/receipts/search?receiptId=${encodeURIComponent(receiptId)}`);
            if (data.receipt) {
                setViewingReceipt(data.receipt);
                setIsViewReceiptDialogOpen(true);
            } else {
                toast.error(t('returns.receiptNotFound'));
            }
        } catch {
            toast.error(t('returns.receiptNotFound'));
        }
    };

    const handleEditReturn = async (returnItem: ReturnRequest) => {
        // Fetch the receipt to show all items
        try {
            const data = await api.get<{ receipt?: Receipt & { shopId?: string } }>(`/receipts/search?receiptId=${encodeURIComponent(returnItem.receiptId)}`);
            if (data.receipt) {
                setViewingReceipt(data.receipt);
                const shopId = (data.receipt as any).shopId;
                setCurrentShopId(shopId ?? null);
                fetchAvailableProducts(shopId);
            }
        } catch { /* silent */ }
        setEditingReturn(returnItem);
        setEditReason(returnItem.reason);

        // Initialize selected items based on the current return
        const initialSelection: SelectedItemsMap = {};
        viewingReceipt?.items.forEach((item: ReceiptItem) => {
            const k = itemKey(item);
            const matchesReturn =
                item.productName === returnItem.productName &&
                (item.bundleId ?? null) === (returnItem.bundleId ?? null);
            initialSelection[k] = {
                selected: matchesReturn,
                returnQty: matchesReturn ? returnItem.returnQuantity : 1,
                productCode: item.productCode,
                bundleId: item.bundleId ?? null,
            };
        });
        setSelectedItems(initialSelection);

        // Reset exchange product states
        setExchangeItems({});
        setSelectedExchangeProduct("");
        setSelectedExchangeQuantity("1");

        setIsEditDialogOpen(true);
    };

    const handleUpdateReturn = (type: "refund" | "exchange") => {
        // Validate selected items
        const hasSelectedItems = Object.values(selectedItems).some(item => item.selected);
        if (!hasSelectedItems) {
            toast.error(t('returns.errorSelectAtLeastOne'));
            return;
        }

        // Set transaction type
        setTransactionType(type);

        // Refund → destination is derived from the original receipt by the backend,
        // so go straight to a single confirm dialog. Exchange still uses card-tap.
        if (type === "refund") {
            setIsRefundConfirmOpen(true);
        } else {
            setCardTapStep("input");
            setCardUidInput("");
            setCardLookupError(null);
            setVerifiedCardholder(null);
            setIsCardTapDialogOpen(true);
        }
    };

    const resetAllDialogs = () => {
        setIsRefundConfirmOpen(false);
        setIsCardTapDialogOpen(false);
        setIsEditDialogOpen(false);
        setEditingReturn(null);
        setEditReason("");
        setExchangeItems({});
        setSelectedExchangeProduct("");
        setSelectedExchangeQuantity("1");
        setSelectedItems({});
        setCardTapStep("input");
        setCardUidInput("");
        setCardLookupError(null);
        setVerifiedCardholder(null);
    };

    const handleConfirmRefund = async () => {
        if (!editingReturn) return;
        try {
            const result = await api.post<{
                refundAmount: number;
                refundMethod: string;
                refundedTo?: { type: string; label: string; balanceAfter?: number; maskedCard?: string };
            }>(`/returns/${editingReturn.id}/refund`, {
                returnItems: buildReturnItems(selectedItems),
                reason: editReason || editingReturn.reason,
            });

            // Build credit note result for the summary dialog
            const returnedItems = buildReturnItems(selectedItems).map((ri) => {
                const item = viewingReceipt?.items.find((i: ReceiptItem) => i.productCode === ri.productCode);
                return {
                    productCode: ri.productCode,
                    productName: item?.productName ?? ri.productCode,
                    returnQty: ri.returnQuantity,
                    unitPrice: item?.price ?? 0,
                };
            });

            setReturnResult({
                refundAmount: result.refundAmount,
                refundMethod: result.refundMethod,
                refundedTo: result.refundedTo,
                receiptId: editingReturn.receiptId,
                receiptDate: viewingReceipt?.date ?? "",
                payerLabel: viewingReceipt?.payer?.label ?? viewingReceipt?.studentName ?? "",
                returnedItems,
                returnedAt: new Date().toISOString(),
                reason: editReason || editingReturn.reason,
            });

            resetAllDialogs();
            setIsCreditNoteDialogOpen(true);
            await fetchReturns();
        } catch (err: any) {
            toast.error(err?.detail ?? "Refund failed");
        }
    };

    const handleCardTap = useCallback(async (uid: string) => {
        if (!editingReturn) return;
        if (!uid) {
            setCardLookupError("กรุณาระบุ UID หรือรหัสนักเรียน");
            return;
        }

        setCardLookupError(null);
        setCardTapStep("processing");

        try {
            // Step 1: Verify card belongs to a registered cardholder.
            // Try customer by-card → customer by-code → user by-card (staff/parent).
            let cardholder: { full_name: string; customer_code?: string };
            let found = false;
            // 1a. customer by card UID
            try {
                cardholder = await api.get<{ full_name: string; customer_code: string }>(
                    `/customers/by-card/${encodeURIComponent(uid)}`,
                );
                found = true;
            } catch (e) {
                if (!(e instanceof ApiError && e.status === 404)) throw e;
            }
            // 1b. customer by student code
            if (!found) {
                try {
                    cardholder = await api.get<{ full_name: string; customer_code: string }>(
                        `/customers/by-code/${encodeURIComponent(uid)}`,
                    );
                    found = true;
                } catch (e) {
                    if (!(e instanceof ApiError && e.status === 404)) throw e;
                }
            }
            // 1c. user (staff/parent) by card UID
            if (!found) {
                const u = await api.get<{ full_name: string; username: string }>(
                    `/users/by-card/${encodeURIComponent(uid)}`,
                );
                cardholder = { full_name: u.full_name, customer_code: u.username };
                found = true;
            }
            if (!found) throw new ApiError(404, "Not found", "NOT_FOUND");
            setVerifiedCardholder(cardholder);

            // Step 2: Process exchange. Refund no longer goes through the card-tap
            // flow — destination is derived server-side from the original receipt.
            const receiptItems = viewingReceipt?.items ?? [];
            const returnValue = buildReturnItems(selectedItems).reduce((sum, ri) => {
                const item = receiptItems.find((i: ReceiptItem) => i.productCode === ri.productCode);
                return sum + (item?.price ?? 0) * ri.returnQuantity;
            }, 0);
            const exchangeValue = buildExchangeItems(exchangeItems).reduce((sum, ei) => {
                const p = availableProducts.find((ap) => ap.productCode === ei.productCode);
                return sum + (p?.price ?? 0) * ei.quantity;
            }, 0);

            await api.post(`/returns/${editingReturn.id}/exchange`, {
                returnItems: buildReturnItems(selectedItems),
                exchangeItems: buildExchangeItems(exchangeItems),
                difference: exchangeValue - returnValue,
                reason: editReason || editingReturn.reason,
            });
            toast.success(t('returns.exchangeSuccess', 'Exchange processed successfully'));

            setCardTapStep("success");
            setTimeout(() => {
                resetAllDialogs();
                fetchReturns();
            }, 1500);
        } catch (err: any) {
            const detail = err instanceof ApiError ? err.detail : err?.message ?? "Transaction failed";
            setCardLookupError(detail);
            setCardTapStep("input");
            setVerifiedCardholder(null);
        }
    }, [editingReturn, editReason, selectedItems, exchangeItems, viewingReceipt, availableProducts]);

    const {
        value: cardUidInput,
        setValue: setCardUidInput,
        inputRef: cardInputRef,
        onChange: onCardInputChange,
        onKeyDown: onCardInputKeyDown,
    } = useRfidInput({
        onSubmit: handleCardTap,
        enabled: isCardTapDialogOpen && cardTapStep === "input",
    });

    return (
        <div className="page-shell">
            <div className="page-header">
                <h1 className="page-title mb-2">{t('returns.title')}</h1>
                <p className="page-description">{t('returns.description')}</p>
            </div>

            <InfoCallout
                id="returns.flow"
                variant="tip"
                title={t('returns.info.flow.title')}
            >
                {t('returns.info.flow.body')}
            </InfoCallout>

            {/* Return Mode Toggle */}
            <Card>
                <CardContent className="py-4">
                    <div className="flex items-center justify-center gap-4">
                        <Button
                            variant={returnMode === "with-receipt" ? "default" : "outline"}
                            onClick={() => setReturnMode("with-receipt")}
                            className="min-w-[160px]"
                        >
                            <Search className="h-4 w-4 mr-2" />
                            {t("returns.withReceipt") || "With Receipt"}
                        </Button>
                        <Button
                            variant={returnMode === "without-receipt" ? "default" : "outline"}
                            onClick={() => {
                                setReturnMode("without-receipt");
                                // Fetch products when switching to no-receipt mode
                                if (!currentShopId) {
                                    fetchAvailableProducts(null);
                                }
                            }}
                            className="min-w-[160px]"
                        >
                            <Package className="h-4 w-4 mr-2" />
                            {t("returns.withoutReceipt") || "Without Receipt"}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Without Receipt Section */}
            {returnMode === "without-receipt" && (
                <NoReceiptReturnPanel
                    currentShopId={currentShopId}
                    onShopChange={(v) => { setCurrentShopId(v); fetchAvailableProducts(v); }}
                    onReturnCreated={fetchReturns}
                />
            )}

            {/* Search Receipt Section (only when with-receipt mode) */}
            {returnMode === "with-receipt" && (
                <>
                    <ReceiptSearchPanel
                        searchReceiptId={searchReceiptId}
                        onSearchReceiptIdChange={setSearchReceiptId}
                        searchStudent={searchStudent}
                        onSearchStudentChange={setSearchStudent}
                        searchDateFrom={searchDateFrom}
                        onSearchDateFromChange={setSearchDateFrom}
                        searchDateTo={searchDateTo}
                        onSearchDateToChange={setSearchDateTo}
                        searchPaymentMethod={searchPaymentMethod}
                        onSearchPaymentMethodChange={setSearchPaymentMethod}
                        onSearch={handleSearchReceipt}
                        searchResults={searchResults}
                        selectedReceipt={selectedReceipt}
                        onPickResult={pickSearchResult}
                    />

                    {/* Receipt Items Table */}
                    {selectedReceipt && (
                        <div className="space-y-6">
                            {/* Receipt Info Bar */}
                            <div className="bg-muted p-4 rounded-lg flex items-center justify-between">
                                <div className="flex items-center gap-6">
                                    <div>
                                        <span className="text-sm text-muted-foreground">{t('returns.receiptId')}:</span>
                                        <span className="ml-2 font-semibold">{selectedReceipt.id}</span>
                                    </div>
                                    <div>
                                        <span className="text-sm text-muted-foreground">{t('returns.date')}:</span>
                                        <span className="ml-2 font-semibold">{selectedReceipt.date}</span>
                                    </div>
                                    <div>
                                        <span className="text-sm text-muted-foreground">{t('returns.paymentChannel')}:</span>
                                        <Badge variant="secondary" className="ml-2">{getPaymentMethodLabel(t, selectedReceipt.paymentMethod)}</Badge>
                                    </div>
                                </div>
                                <div>
                                    <span className="text-sm text-muted-foreground">{t('returns.total')}:</span>
                                    <span className="ml-2 font-bold text-primary text-lg data-number">฿{selectedReceipt.total.toLocaleString()}</span>
                                </div>
                            </div>

                            {/* Items Table — split into returnable vs already-returned */}
                            {(() => {
                                // Compute remaining returnable qty per line (keyed by
                                // productCode + bundleId so bundle vs non-bundle lines that share
                                // a code don't share a return budget).
                                const lineKey = (rOrI: { productCode?: string; bundleId?: number | null }) =>
                                    `${rOrI.productCode ?? ''}::${rOrI.bundleId ?? 0}`;
                                const returnedQtyMap: Record<string, number> = {};
                                const returnInfoMap: Record<string, ReturnRequest[]> = {};
                                existingReturns.forEach(r => {
                                    if (r.productCode) {
                                        const k = lineKey(r);
                                        returnedQtyMap[k] = (returnedQtyMap[k] || 0) + r.returnQuantity;
                                        if (!returnInfoMap[k]) returnInfoMap[k] = [];
                                        returnInfoMap[k].push(r);
                                    }
                                });

                                const itemsWithRemaining = selectedReceipt.items.map(item => {
                                    const k = lineKey(item);
                                    return {
                                        ...item,
                                        alreadyReturned: returnedQtyMap[k] || 0,
                                        remaining: item.quantity - (returnedQtyMap[k] || 0),
                                        returnInfos: returnInfoMap[k] || [],
                                    };
                                });

                                const hasReturnHistory = itemsWithRemaining.some(i => i.alreadyReturned > 0);
                                const returnableItems = itemsWithRemaining.filter(i => i.remaining > 0);

                                return (
                                    <>
                                        {/* Return History for this receipt */}
                                        {hasReturnHistory && (
                                            <Card className="border-amber-200 bg-amber-50/50">
                                                <CardHeader className="pb-2">
                                                    <CardTitle className="text-sm text-amber-700">
                                                        {t('returns.alreadyReturned', 'ประวัติการคืน/เปลี่ยนสินค้า')}
                                                    </CardTitle>
                                                </CardHeader>
                                                <CardContent>
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow>
                                                                <TableHead>{t('returns.product')}</TableHead>
                                                                <TableHead className="text-center">{t('returns.price')}</TableHead>
                                                                <TableHead className="text-center">{t('returns.quantityPurchased')}</TableHead>
                                                                <TableHead className="text-center">{t('returns.returnedQty', 'คืนแล้ว')}</TableHead>
                                                                <TableHead className="text-center">{t('returns.remainingQty', 'คืนได้อีก')}</TableHead>
                                                                <TableHead className="text-center">{t('returns.status')}</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {itemsWithRemaining.filter(i => i.alreadyReturned > 0).map((item) => (
                                                                <TableRow key={lineKey(item)} className={item.remaining <= 0 ? "opacity-50" : ""}>
                                                                    <TableCell>
                                                                        <div>
                                                                            <p className="font-medium">{item.productName}</p>
                                                                            <p className="text-xs text-muted-foreground">{t('returns.code')}: {item.productCode}</p>
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell className="text-center data-number">฿{item.price}</TableCell>
                                                                    <TableCell className="text-center data-number">{item.quantity}</TableCell>
                                                                    <TableCell className="text-center data-number font-medium text-amber-600">{item.alreadyReturned}</TableCell>
                                                                    <TableCell className="text-center data-number font-medium">
                                                                        {item.remaining > 0 ? (
                                                                            <span className="text-green-600">{item.remaining}</span>
                                                                        ) : (
                                                                            <span className="text-muted-foreground">0</span>
                                                                        )}
                                                                    </TableCell>
                                                                    <TableCell className="text-center">
                                                                        {item.returnInfos.map((ri, idx) => (
                                                                            <Badge key={idx} variant={ri.status === 'approved' ? 'success' : 'secondary'} className="mr-1">
                                                                                {ri.status === 'approved' ? t('returns.approved') : t('returns.pending')} x{ri.returnQuantity}
                                                                            </Badge>
                                                                        ))}
                                                                    </TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </CardContent>
                                            </Card>
                                        )}

                                        {/* Returnable Items */}
                                        <Card>
                                            <CardHeader>
                                                <CardTitle>{t('returns.selectItems')}</CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                {returnableItems.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                                                        <RefreshCw className="h-8 w-8 mb-2 opacity-40" />
                                                        <p>{t('returns.allItemsReturned', 'สินค้าทั้งหมดในใบเสร็จนี้ถูกคืนครบแล้ว')}</p>
                                                    </div>
                                                ) : (
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow>
                                                                <TableHead className="w-12"></TableHead>
                                                                <TableHead>{t('returns.product')}</TableHead>
                                                                <TableHead className="text-center">{t('returns.price')}</TableHead>
                                                                <TableHead className="text-center">{t('returns.remainingQty', 'คืนได้')}</TableHead>
                                                                <TableHead className="text-center">{t('returns.quantityReturn')}</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {returnableItems.map((item) => {
                                                                const k = itemKey(item);
                                                                const isSelected = selectedItems[k]?.selected || false;
                                                                const returnQty = selectedItems[k]?.returnQty || 1;
                                                                const maxQty = item.remaining;

                                                                return (
                                                                    <TableRow key={k}>
                                                                        <TableCell>
                                                                            <Checkbox
                                                                                checked={isSelected}
                                                                                onCheckedChange={(checked) =>
                                                                                    handleItemSelect(item, checked as boolean, maxQty)
                                                                                }
                                                                            />
                                                                        </TableCell>
                                                                        <TableCell>
                                                                            <div>
                                                                                <p className="font-medium">{item.productName}</p>
                                                                                <p className="text-xs text-muted-foreground">{t('returns.code')}: {item.productCode}</p>
                                                                                {item.alreadyReturned > 0 && (
                                                                                    <p className="text-xs text-amber-600">{t('returns.previouslyReturned', 'คืนไปแล้ว')}: {item.alreadyReturned}/{item.quantity}</p>
                                                                                )}
                                                                            </div>
                                                                        </TableCell>
                                                                        <TableCell className="text-center data-number">฿{item.price}</TableCell>
                                                                        <TableCell className="text-center data-number font-medium text-green-600">{maxQty}</TableCell>
                                                                        <TableCell className="text-center">
                                                                            {isSelected ? (
                                                                                <Input
                                                                                    type="number"
                                                                                    min="1"
                                                                                    max={maxQty}
                                                                                    value={returnQty}
                                                                                    onChange={(e) =>
                                                                                        handleQuantityChange(item, parseInt(e.target.value), maxQty)
                                                                                    }
                                                                                    className="w-20 mx-auto"
                                                                                />
                                                                            ) : (
                                                                                <span className="text-muted-foreground">-</span>
                                                                            )}
                                                                        </TableCell>
                                                                    </TableRow>
                                                                );
                                                            })}
                                                        </TableBody>
                                                    </Table>
                                                )}
                                            </CardContent>
                                        </Card>
                                    </>
                                );
                            })()}

                            {/* Reason + Submit */}
                            <Card>
                                <CardContent className="pt-6">
                                    <div className="space-y-4">
                                        <div>
                                            <Label htmlFor="reason">{t('returns.reason')}</Label>
                                            <Textarea
                                                id="reason"
                                                placeholder={t('returns.enterReason')}
                                                value={reason}
                                                onChange={(e) => setReason(e.target.value)}
                                                rows={3}
                                                className="mt-2"
                                            />
                                        </div>

                                        <Button onClick={handleSubmitReturn} className="w-full" size="lg">
                                            {t('returns.saveReturnRequest')}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </>
            )}

            {/* ── Today's Sales ───────────────────────────────────────────────── */}
            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <CardTitle className="flex items-center gap-2">
                            <Calendar className="h-5 w-5 text-primary" />
                            {receiptSearchTerm.trim() ? t("returns.searchResults") : t("returns.todaySales")}
                        </CardTitle>
                        <div className="flex items-center gap-2">
                            <Search className="h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder={t("returns.searchPlaceholder")}
                                value={receiptSearchTerm}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setReceiptSearchTerm(v);
                                    if (v.trim()) loadPosReceipts(v.trim());
                                    else loadPosReceipts();
                                }}
                                className="w-full sm:max-w-xs"
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {posReceiptsLoading ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
                    ) : displayedReceipts.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">
                            {receiptSearchTerm.trim() ? t("returns.noResults") : t("returns.noSalesToday")}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("returns.dateTime")}</TableHead>
                                    <TableHead>{t("returns.receiptId")}</TableHead>
                                    <TableHead>{t("returns.buyer")}</TableHead>
                                    <TableHead>{t("returns.paymentMethod")}</TableHead>
                                    <TableHead className="text-right">{t("returns.total")}</TableHead>
                                    <TableHead className="text-center">{t("returns.status")}</TableHead>
                                    <TableHead className="text-center">{t("returns.actions", "Actions")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {displayedReceipts.map((r) => (
                                    <TableRow key={r.id} className={r.status === "voided" ? "opacity-50" : ""}>
                                        <TableCell className="text-sm tabular-nums text-muted-foreground whitespace-nowrap">
                                            {fmtDateTime(r.transaction_date)}
                                        </TableCell>
                                        <TableCell className="font-mono font-medium">{r.receipt_number}</TableCell>
                                        <TableCell className="text-sm">{r.payer_label ?? "—"}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="text-xs">{getPaymentMethodLabel(t, r.payment_method)}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums font-semibold">
                                            ฿{r.total.toFixed(2)}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant={r.status === "voided" ? "destructive" : "success"}>
                                                {r.status === "voided" ? t("returns.statusVoided", "Voided") : t("returns.statusActive", "Active")}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={r.status === "voided"}
                                                    onClick={() => handleStartReturn(r.receipt_number, "refund")}
                                                    className="h-7 text-xs"
                                                >
                                                    <RefreshCw className="h-3 w-3 mr-1" />
                                                    {t("returns.refund", "Refund")}
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={r.status === "voided"}
                                                    onClick={() => handleStartReturn(r.receipt_number, "exchange")}
                                                    className="h-7 text-xs"
                                                >
                                                    <ArrowLeftRight className="h-3 w-3 mr-1" />
                                                    {t("returns.exchange", "Exchange")}
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Returns History */}
            <ReturnHistoryTable
                returns={returns}
                onViewReceipt={handleViewReceipt}
                onEditReturn={handleEditReturn}
                onDeleteReturn={setDeleteReturn}
            />

            <EditReturnDialog
                open={isEditDialogOpen}
                onOpenChange={setIsEditDialogOpen}
                editingReturn={editingReturn}
                viewingReceipt={viewingReceipt}
                selectedItems={selectedItems}
                setSelectedItems={setSelectedItems}
                exchangeItems={exchangeItems}
                setExchangeItems={setExchangeItems}
                selectedExchangeProduct={selectedExchangeProduct}
                setSelectedExchangeProduct={setSelectedExchangeProduct}
                selectedExchangeQuantity={selectedExchangeQuantity}
                setSelectedExchangeQuantity={setSelectedExchangeQuantity}
                availableProducts={availableProducts}
                editReason={editReason}
                setEditReason={setEditReason}
                onItemSelect={handleItemSelect}
                onQuantityChange={handleQuantityChange}
                onCancel={() => {
                    setIsEditDialogOpen(false);
                    setSelectedItems({});
                    setViewingReceipt(null);
                    setExchangeItems({});
                }}
                onRequestRefund={() => handleUpdateReturn("refund")}
                onRequestExchange={() => handleUpdateReturn("exchange")}
            />

            {/* View Receipt Dialog */}
            <Dialog open={isViewReceiptDialogOpen} onOpenChange={setIsViewReceiptDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('returns.receiptDetails')}</DialogTitle>
                        <DialogDescription>
                            {t('returns.receiptId')}: {viewingReceipt?.id}
                        </DialogDescription>
                    </DialogHeader>
                    {viewingReceipt && (
                        <div className="space-y-4">
                            <div className="bg-secondary p-4 rounded-lg space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-sm text-muted-foreground">{t('returns.date')}:</span>
                                    <span className="font-semibold">{viewingReceipt.date}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-sm text-muted-foreground">{t('returns.paymentChannel')}:</span>
                                    <Badge variant="secondary">{getPaymentMethodLabel(t, viewingReceipt.paymentMethod)}</Badge>
                                </div>
                            </div>

                            <Separator />

                            <div>
                                <h4 className="font-semibold mb-3">{t('returns.productList')}</h4>
                                <div className="space-y-2">
                                    {viewingReceipt.items.map((item, index) => (
                                        <div key={index} className="flex justify-between items-start p-3 bg-secondary/50 rounded-lg">
                                            <div className="flex-1">
                                                <p className="font-medium">{item.productName}</p>
                                                <p className="text-sm text-muted-foreground data-number">
                                                    ฿{item.price} x {item.quantity}
                                                </p>
                                            </div>
                                            <p className="font-semibold data-number">
                                                ฿{(item.price * item.quantity).toFixed(2)}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <Separator />

                            <div className="flex justify-between text-lg font-bold">
                                <span>{t('returns.grandTotal')}</span>
                                <span className="text-primary data-number">฿{viewingReceipt.total.toFixed(2)}</span>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsViewReceiptDialogOpen(false)}>
                            {t('returns.close')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <RefundConfirmDialog
                open={isRefundConfirmOpen}
                onOpenChange={setIsRefundConfirmOpen}
                viewingReceipt={viewingReceipt}
                selectedItems={selectedItems}
                onConfirm={handleConfirmRefund}
            />

            <CardTapDialog
                open={isCardTapDialogOpen}
                cardTapStep={cardTapStep}
                transactionType={transactionType}
                cardInputRef={cardInputRef}
                cardUidInput={cardUidInput}
                onCardInputChange={onCardInputChange}
                onCardInputKeyDown={onCardInputKeyDown}
                cardLookupError={cardLookupError}
                onDismissLookupError={() => setCardLookupError(null)}
                onConfirmTap={() => handleCardTap(cardUidInput)}
                verifiedCardholder={verifiedCardholder}
            />

            {/* ── Credit Note Summary Dialog ───────────────────────────────────── */}
            <Dialog open={isCreditNoteDialogOpen} onOpenChange={(open) => { if (!open) { setIsCreditNoteDialogOpen(false); setReturnResult(null); } }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-success">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            {t("returns.refundSuccessTitle", "Refund successful")}
                        </DialogTitle>
                        <DialogDescription>
                            {t("returns.originalReceipt", "Original receipt")}: {returnResult?.receiptId}
                        </DialogDescription>
                    </DialogHeader>

                    {returnResult && (
                        <div className="space-y-4 py-2">
                            {/* Summary card */}
                            <div className="bg-success/10 border border-success/30 p-4 rounded-lg text-center">
                                <p className="text-xs text-muted-foreground mb-1">{t("returns.refundAmount", "Refund amount")}</p>
                                <p className="text-3xl font-bold text-success data-number">฿{returnResult.refundAmount.toFixed(2)}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {returnResult.refundedTo
                                        ? returnResult.refundedTo.balanceAfter !== undefined
                                            ? t("returns.refundDestWalletWithBalance", { label: returnResult.refundedTo.label, balance: returnResult.refundedTo.balanceAfter.toFixed(2), defaultValue: "Wallet — {{label}} (balance ฿{{balance}})" })
                                            : returnResult.refundedTo.type === "edc_card"
                                                ? `EDC card ${returnResult.refundedTo.maskedCard || "****"}`
                                                : returnResult.refundedTo.label
                                        : returnResult.refundMethod}
                                </p>
                            </div>

                            {/* Items */}
                            <div>
                                <p className="text-xs font-semibold text-muted-foreground mb-2">{t("returns.returnedItemsLabel", "Returned items")}</p>
                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                    {returnResult.returnedItems.map((item, idx) => (
                                        <div key={idx} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                                            <div>
                                                <span className="font-medium">{item.productName}</span>
                                                <span className="text-xs text-muted-foreground ml-1">x{item.returnQty}</span>
                                            </div>
                                            <span className="data-number text-sm">฿{(item.unitPrice * item.returnQty).toFixed(2)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Meta */}
                            <div className="text-xs text-muted-foreground space-y-0.5">
                                <div className="flex justify-between">
                                    <span>{t("returns.buyer", "Buyer")}</span>
                                    <span>{returnResult.payerLabel || "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>{t("returns.returnDate", "Return date")}</span>
                                    <span>{fmtDateTime(returnResult.returnedAt)}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => { setIsCreditNoteDialogOpen(false); setReturnResult(null); }}
                        >
                            {t("common.done", "Done")}
                        </Button>
                        <Button
                            onClick={() => {
                                if (returnResult) {
                                    printReturnSlip(returnResult, {
                                        i18nLanguage: i18n.language,
                                        schoolInfo,
                                        popupBlockedMessage: t("returns.popupBlocked", "Cannot open print window — please allow pop-ups"),
                                    });
                                }
                            }}
                            className="gap-2"
                        >
                            <Printer className="h-4 w-4" />
                            {t("returns.printCreditNote", "Print Credit Note")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Duplicate Return Conflict Modal ──────────────────────────────── */}
            <Dialog open={isDuplicateDialogOpen} onOpenChange={setIsDuplicateDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-destructive">
                            {t('returns.duplicateReturnTitle', 'ไม่สามารถคืนสินค้าซ้ำได้')}
                        </DialogTitle>
                        <DialogDescription>
                            {t('returns.duplicateReturnDescription', 'สินค้าต่อไปนี้มีคำขอคืนสินค้าอยู่แล้ว ไม่สามารถคืนซ้ำได้:')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 max-h-60 overflow-auto">
                        {duplicateConflicts.map((conflict) => (
                            <div key={conflict.id} className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                                <div>
                                    <p className="font-medium text-sm">{conflict.productName}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {t('returns.code')}: {conflict.productCode} &middot; {t('returns.quantityReturn')}: {conflict.returnQuantity}
                                    </p>
                                </div>
                                <Badge variant={conflict.status === 'approved' ? 'success' : 'secondary'}>
                                    {conflict.status === 'approved' ? t('returns.approved') : t('returns.pending')}
                                </Badge>
                            </div>
                        ))}
                    </div>
                    <DialogFooter>
                        <Button onClick={() => setIsDuplicateDialogOpen(false)}>
                            {t('returns.understood', 'รับทราบ')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <AlertDialog open={!!deleteReturn} onOpenChange={(open) => !open && setDeleteReturn(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('returns.confirmDelete')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('returns.deleteReturnDesc', {
                                receipt: deleteReturn?.receiptId ?? "",
                                product: deleteReturn?.productName ?? "",
                                defaultValue: `Return record for receipt {{receipt}} ({{product}}) will be permanently deleted. This action cannot be undone.`,
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={async () => {
                                if (!deleteReturn) return;
                                try {
                                    await api.delete(`/returns/${deleteReturn.id}`);
                                    toast.success(t('returns.deleteSuccess'));
                                    await fetchReturns();
                                } catch (err: any) {
                                    toast.error(err?.detail ?? "Failed to delete");
                                } finally {
                                    setDeleteReturn(null);
                                }
                            }}
                        >
                            {t('common.delete', 'Delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default Returns;
