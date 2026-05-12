import { useState, useEffect, useCallback } from "react";
import { useRfidInput } from "@/hooks/useRfidInput";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Search, Calendar, Eye, Trash2, Edit, Plus, X, CreditCard } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { InfoCallout } from "@/components/InfoCallout";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ReceiptItem {
  productCode: string;
  productName: string;
  quantity: number;
  price: number;
}

interface Receipt {
  id: string;
  date: string;
  items: ReceiptItem[];
  total: number;
  paymentMethod: "student" | "qr" | "cash" | "department";
  studentId?: string;
  studentName?: string;
}

interface ReturnRequest {
  id: number;
  receiptId: string;
  productCode?: string;
  productName: string;
  quantity: number;
  returnQuantity: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  date: string;
  priceType: "internal" | "normal";
  voidStatus?: "active" | "voided";
  returnStatus?: "no-return" | "partial-return" | "full-return";
}

const Returns = () => {
  const { t } = useTranslation();
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [availableProducts, setAvailableProducts] = useState<ReceiptItem[]>([]);

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

  useEffect(() => { fetchReturns(); }, [fetchReturns]);

  // Existing returns for the searched receipt (to show returnable vs already-returned)
  const [existingReturns, setExistingReturns] = useState<ReturnRequest[]>([]);

  // Duplicate conflict modal
  const [isDuplicateDialogOpen, setIsDuplicateDialogOpen] = useState(false);
  const [duplicateConflicts, setDuplicateConflicts] = useState<ReturnRequest[]>([]);

  // Search states
  const [searchReceiptId, setSearchReceiptId] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [searchPaymentMethod, setSearchPaymentMethod] = useState<string>("all");
  const [searchStudent, setSearchStudent] = useState("");

  // Selected receipt
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);

  // Return form states
  const [selectedItems, setSelectedItems] = useState<{ [key: string]: { selected: boolean; returnQty: number } }>({});
  const [reason, setReason] = useState("");

  // History search
  const [historySearchTerm, setHistorySearchTerm] = useState("");

  // Edit dialog states
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingReturn, setEditingReturn] = useState<ReturnRequest | null>(null);
  const [editReturnQty, setEditReturnQty] = useState("");
  const [editReason, setEditReason] = useState("");

  // View receipt dialog states
  const [isViewReceiptDialogOpen, setIsViewReceiptDialogOpen] = useState(false);
  const [viewingReceipt, setViewingReceipt] = useState<Receipt | null>(null);

  // Exchange product states
  const [exchangeItems, setExchangeItems] = useState<{ [key: string]: { productCode: string; quantity: number } }>({});
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

  // Refund method selection dialog
  const [isRefundMethodDialogOpen, setIsRefundMethodDialogOpen] = useState(false);

  // Cash refund confirmation dialog
  const [isCashRefundConfirmOpen, setIsCashRefundConfirmOpen] = useState(false);

  const getPaymentMethodLabel = (method: string) => {
    switch (method) {
      case "student": return t('returns.studentCard');
      case "qr": return t('returns.qrPromptpay');
      case "cash": return t('returns.cash');
      case "department": return t('returns.departmentCard');
      default: return method;
    }
  };

  const handleSearchReceipt = async () => {
    if (!searchReceiptId && !searchDate && searchPaymentMethod === "all" && !searchStudent) {
      toast.error(t('returns.errorPleaseEnterCriteria'));
      return;
    }

    try {
      const data = await api.get<{ receipt?: Receipt & { shopId?: string } }>(`/receipts/search?receiptId=${encodeURIComponent(searchReceiptId)}`);
      if (data.receipt) {
        setSelectedReceipt(data.receipt);
        setSelectedItems({});
        setReason("");
        // Load exchange products for same shop only
        const shopId = (data.receipt as any).shopId;
        setCurrentShopId(shopId ?? null);
        fetchAvailableProducts(shopId);
        // Fetch existing returns for this receipt
        try {
          const existingData = await api.get<ReturnRequest[]>(
            `/returns/by-receipt?receiptId=${encodeURIComponent(data.receipt.id)}`
          );
          setExistingReturns(existingData);
        } catch {
          setExistingReturns([]);
        }
        toast.success(t('returns.receiptFound') + ": " + data.receipt.id);
      } else {
        setSelectedReceipt(null);
        setExistingReturns([]);
        toast.error(t('returns.receiptNotFound'));
      }
    } catch {
      setSelectedReceipt(null);
      setExistingReturns([]);
      toast.error(t('returns.receiptNotFound'));
    }
  };

  const handleItemSelect = (productCode: string, isSelected: boolean, maxQty: number) => {
    setSelectedItems((prev) => ({
      ...prev,
      [productCode]: {
        selected: isSelected,
        returnQty: isSelected ? 1 : 0,
      },
    }));
  };

  const handleQuantityChange = (productCode: string, qty: number, maxQty: number) => {
    if (qty < 1 || qty > maxQty) return;

    setSelectedItems((prev) => ({
      ...prev,
      [productCode]: {
        ...prev[productCode],
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

    const items = selectedProducts.map(([productCode, data]) => {
      const item = selectedReceipt.items.find((i: ReceiptItem) => i.productCode === productCode);
      return {
        productCode,
        productName: item?.productName ?? productCode,
        quantity: item?.quantity ?? data.returnQty,
        returnQuantity: data.returnQty,
        price: item?.price ?? 0,
      };
    });

    try {
      await api.post("/returns/create", {
        receiptId: selectedReceipt.id,
        items,
        reason: reason.trim(),
      });
      toast.success(t('returns.returnRequestSaved'));
      await fetchReturns();

      // Reset form
      setSelectedReceipt(null);
      setExistingReturns([]);
      setSelectedItems({});
      setReason("");
      setSearchReceiptId("");
      setSearchDate("");
      setSearchPaymentMethod("all");
      setSearchStudent("");
    } catch (err: any) {
      if (err?.status === 409) {
        // Show modal with conflicting items
        setDuplicateConflicts(existingReturns.filter(r =>
          Object.keys(selectedItems).some(code =>
            selectedItems[code].selected && r.productCode === code
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
        toast.error(err?.detail ?? "Failed to create return");
      }
    }
  };

  const handleStatusChange = async (id: number, newStatus: "approved" | "rejected") => {
    try {
      await api.put(`/returns/${id}`, { status: newStatus });
      toast.success(newStatus === "approved" ? t('returns.approved') : t('returns.rejected'));
      await fetchReturns();
    } catch (err: any) {
      toast.error(err?.detail ?? "Failed to update status");
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
    setEditReturnQty(returnItem.returnQuantity.toString());
    setEditReason(returnItem.reason);

    // Initialize selected items based on the current return
    const initialSelection: { [key: string]: { selected: boolean; returnQty: number } } = {};
    viewingReceipt?.items.forEach((item: ReceiptItem) => {
      if (item.productName === returnItem.productName) {
        initialSelection[item.productCode] = {
          selected: true,
          returnQty: returnItem.returnQuantity,
        };
      } else {
        initialSelection[item.productCode] = {
          selected: false,
          returnQty: 1,
        };
      }
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

    // If refund, open refund method selection dialog
    // If exchange, open card tap dialog directly
    if (type === "refund") {
      setIsRefundMethodDialogOpen(true);
    } else {
      setCardTapStep("input");
      setCardUidInput("");
      setCardLookupError(null);
      setVerifiedCardholder(null);
      setIsCardTapDialogOpen(true);
    }
  };

  const handleRefundMethodSelect = (method: "cash" | "card") => {
    setIsRefundMethodDialogOpen(false);

    if (method === "card") {
      // Open card tap dialog for card refund
      setCardTapStep("input");
      setCardUidInput("");
      setCardLookupError(null);
      setVerifiedCardholder(null);
      setIsCardTapDialogOpen(true);
    } else {
      // For cash refund, open confirmation dialog
      setIsCashRefundConfirmOpen(true);
    }
  };

  const resetAllDialogs = () => {
    setIsCashRefundConfirmOpen(false);
    setIsCardTapDialogOpen(false);
    setIsEditDialogOpen(false);
    setEditingReturn(null);
    setEditReturnQty("");
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

  /** Build returnItems payload from selectedItems state */
  const buildReturnItems = () =>
    Object.entries(selectedItems)
      .filter(([_, d]) => d.selected)
      .map(([code, d]) => ({ productCode: code, returnQuantity: d.returnQty }));

  /** Build exchangeItems payload from exchangeItems state */
  const buildExchangeItems = () =>
    Object.entries(exchangeItems)
      .filter(([_, d]) => d.productCode)
      .map(([_, d]) => ({ productCode: d.productCode, quantity: d.quantity }));

  const handleConfirmCashRefund = async () => {
    if (!editingReturn) return;
    try {
      await api.post(`/returns/${editingReturn.id}/refund`, {
        returnItems: buildReturnItems(),
        refundMethod: "cash",
        reason: editReason || editingReturn.reason,
      });
      toast.success(t('returns.refundSuccess', 'Refund processed successfully'));
      resetAllDialogs();
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
      // Try by-card first, fall back to by-code (mirrors POS RFID flow).
      let cardholder: { full_name: string; customer_code?: string };
      try {
        cardholder = await api.get<{ full_name: string; customer_code: string }>(
          `/customers/by-card/${encodeURIComponent(uid)}`,
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          cardholder = await api.get<{ full_name: string; customer_code: string }>(
            `/customers/by-code/${encodeURIComponent(uid)}`,
          );
        } else {
          throw e;
        }
      }
      setVerifiedCardholder(cardholder);

      // Step 2: Process refund or exchange.
      if (transactionType === "exchange") {
        const receiptItems = viewingReceipt?.items ?? [];
        const returnValue = buildReturnItems().reduce((sum, ri) => {
          const item = receiptItems.find((i: ReceiptItem) => i.productCode === ri.productCode);
          return sum + (item?.price ?? 0) * ri.returnQuantity;
        }, 0);
        const exchangeValue = buildExchangeItems().reduce((sum, ei) => {
          const p = availableProducts.find((ap) => ap.productCode === ei.productCode);
          return sum + (p?.price ?? 0) * ei.quantity;
        }, 0);

        await api.post(`/returns/${editingReturn.id}/exchange`, {
          returnItems: buildReturnItems(),
          exchangeItems: buildExchangeItems(),
          difference: exchangeValue - returnValue,
          reason: editReason || editingReturn.reason,
        });
        toast.success(t('returns.exchangeSuccess', 'Exchange processed successfully'));
      } else {
        await api.post(`/returns/${editingReturn.id}/refund`, {
          returnItems: buildReturnItems(),
          refundMethod: "card",
          reason: editReason || editingReturn.reason,
        });
        toast.success(t('returns.refundSuccess', 'Refund processed successfully'));
      }

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
  }, [editingReturn, transactionType, editReason, buildReturnItems, buildExchangeItems, viewingReceipt, availableProducts]);

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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge variant="success">{t('returns.approved')}</Badge>;
      case "rejected":
        return <Badge variant="destructive">{t('returns.rejected')}</Badge>;
      default:
        return <Badge variant="warning">{t('returns.pending')}</Badge>;
    }
  };

  const filteredReturns = returns.filter(
    (item) =>
      item.receiptId.toLowerCase().includes(historySearchTerm.toLowerCase()) ||
      item.productName.toLowerCase().includes(historySearchTerm.toLowerCase())
  );

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

      {/* Search Receipt Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-xl">
            <Search className="h-6 w-6 mr-2 text-primary" />
            {t('returns.searchReceipt')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="searchReceiptId" className="text-sm font-semibold">{t('returns.receiptId')}</Label>
              <Input
                id="searchReceiptId"
                placeholder="R-001"
                value={searchReceiptId}
                onChange={(e) => setSearchReceiptId(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="searchStudent" className="text-sm font-semibold">รหัส/ชื่อนักเรียน</Label>
              <Input
                id="searchStudent"
                placeholder="S001 หรือ สมชาย"
                value={searchStudent}
                onChange={(e) => setSearchStudent(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="searchDate" className="text-sm font-semibold">{t('returns.purchaseDate')}</Label>
              <DatePicker
                id="searchDate"
                value={searchDate}
                onChange={setSearchDate}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="searchPaymentMethod" className="text-sm font-semibold">{t('returns.paymentType')}</Label>
              <Select value={searchPaymentMethod} onValueChange={setSearchPaymentMethod}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder={t('returns.all')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('returns.all')}</SelectItem>
                  <SelectItem value="student">{t('returns.studentCard')}</SelectItem>
                  <SelectItem value="qr">{t('returns.qrPromptpay')}</SelectItem>
                  <SelectItem value="cash">{t('returns.cash')}</SelectItem>
                  <SelectItem value="department">{t('returns.departmentCard')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end mt-6">
            <Button onClick={handleSearchReceipt} className="px-8">
              <Search className="h-4 w-4 mr-2" />
              {t('returns.search')}
            </Button>
          </div>
        </CardContent>
      </Card>

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
                <Badge variant="secondary" className="ml-2">{getPaymentMethodLabel(selectedReceipt.paymentMethod)}</Badge>
              </div>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">{t('returns.total')}:</span>
              <span className="ml-2 font-bold text-primary text-lg data-number">฿{selectedReceipt.total.toLocaleString()}</span>
            </div>
          </div>

          {/* Items Table — split into returnable vs already-returned */}
          {(() => {
            // Compute remaining returnable qty per product
            const returnedQtyMap: Record<string, number> = {};
            const returnInfoMap: Record<string, ReturnRequest[]> = {};
            existingReturns.forEach(r => {
              if (r.productCode) {
                returnedQtyMap[r.productCode] = (returnedQtyMap[r.productCode] || 0) + r.returnQuantity;
                if (!returnInfoMap[r.productCode]) returnInfoMap[r.productCode] = [];
                returnInfoMap[r.productCode].push(r);
              }
            });

            const itemsWithRemaining = selectedReceipt.items.map(item => ({
              ...item,
              alreadyReturned: returnedQtyMap[item.productCode] || 0,
              remaining: item.quantity - (returnedQtyMap[item.productCode] || 0),
              returnInfos: returnInfoMap[item.productCode] || [],
            }));

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
                            <TableHead className="text-center">{t('returns.status', 'สถานะ')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {itemsWithRemaining.filter(i => i.alreadyReturned > 0).map((item) => (
                            <TableRow key={item.productCode} className={item.remaining <= 0 ? "opacity-50" : ""}>
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
                            const isSelected = selectedItems[item.productCode]?.selected || false;
                            const returnQty = selectedItems[item.productCode]?.returnQty || 1;
                            const maxQty = item.remaining;

                            return (
                              <TableRow key={item.productCode}>
                                <TableCell>
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={(checked) =>
                                      handleItemSelect(item.productCode, checked as boolean, maxQty)
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
                                        handleQuantityChange(item.productCode, parseInt(e.target.value), maxQty)
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

      {/* Returns History */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{t('returns.history')}</CardTitle>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('returns.searchReceiptOrProduct')}
                value={historySearchTerm}
                onChange={(e) => setHistorySearchTerm(e.target.value)}
                className="w-full sm:max-w-xs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('returns.date')}</TableHead>
                <TableHead>{t('returns.receiptId')}</TableHead>
                <TableHead>ชื่อผู้ซื้อ</TableHead>
                <TableHead>{t('returns.type')}</TableHead>
                <TableHead>{t('returns.paymentMethod')}</TableHead>
                <TableHead className="text-center">{t('returns.returnStatus')}</TableHead>
                <TableHead className="text-center">{t('returns.status', 'สถานะ')}</TableHead>
                <TableHead className="text-center">{t('returns.manage')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReturns.map((item) => {
                return (
                  <TableRow key={item.id}>
                    <TableCell>{item.date}</TableCell>
                    <TableCell className="font-medium">{item.receiptId}</TableCell>
                    <TableCell>
                      <span className="text-sm">{item.productName}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.priceType === "internal" ? "default" : "secondary"}>
                        {item.priceType === "internal" ? t('returns.internalUse') : t('returns.normalPrice')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {item.receiptId}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={
                          item.returnStatus === "full-return" ? "default" :
                          item.returnStatus === "partial-return" ? "secondary" :
                          "outline"
                        }
                      >
                        {item.returnStatus === "full-return" ? t('returns.fullReturn') :
                         item.returnStatus === "partial-return" ? t('returns.partialReturn') :
                         t('returns.noReturn')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {item.status === "pending" ? (
                        <div className="flex gap-1 justify-center">
                          <Button size="sm" variant="outline" className="text-xs h-7 text-green-600 border-green-300 hover:bg-green-50"
                            onClick={() => handleStatusChange(item.id, "approved")}>
                            {t('returns.approve', 'อนุมัติ')}
                          </Button>
                          <Button size="sm" variant="outline" className="text-xs h-7 text-red-600 border-red-300 hover:bg-red-50"
                            onClick={() => handleStatusChange(item.id, "rejected")}>
                            {t('returns.reject', 'ปฏิเสธ')}
                          </Button>
                        </div>
                      ) : (
                        <Badge variant={item.status === "approved" ? "success" : "destructive"}>
                          {item.status === "approved" ? t('returns.approved') : t('returns.rejected')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                    <div className="flex gap-2 justify-center">
                      <IconButton
                        size="sm"
                        tooltip={t('returns.viewDetails')}
                        onClick={() => handleViewReceipt(item.receiptId)}
                      >
                        <Eye className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        size="sm"
                        tooltip={t('returns.edit')}
                        onClick={() => handleEditReturn(item)}
                      >
                        <Edit className="h-4 w-4 text-primary" />
                      </IconButton>
                      <IconButton
                        size="sm"
                        tooltip={t('returns.delete')}
                        onClick={async () => {
                          if (confirm(t('returns.confirmDelete'))) {
                            try {
                              await api.delete(`/returns/${item.id}`);
                              toast.success(t('returns.deleteSuccess'));
                              await fetchReturns();
                            } catch (err: any) {
                              toast.error(err?.detail ?? "Failed to delete");
                            }
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('returns.editReturn')}</DialogTitle>
            <DialogDescription>
              {t('returns.editReturnDesc')}
            </DialogDescription>
          </DialogHeader>
          {editingReturn && viewingReceipt && (
            <div className="space-y-4">
              <div className="bg-secondary p-4 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('returns.receiptId')}:</span>
                  <span className="font-semibold">{editingReturn.receiptId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('returns.date')}:</span>
                  <span className="font-semibold">{viewingReceipt.date}</span>
                </div>
              </div>

              <Separator />

              {/* Items Selection Table */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-base font-semibold">{t('returns.selectItems')}</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const allSelected: { [key: string]: { selected: boolean; returnQty: number } } = {};
                        viewingReceipt?.items.forEach((item) => {
                          allSelected[item.productCode] = {
                            selected: true,
                            returnQty: item.quantity,
                          };
                        });
                        setSelectedItems(allSelected);
                        toast.success(t('returns.allSelected'));
                      }}
                    >
                      {t('returns.selectAll')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const allDeselected: { [key: string]: { selected: boolean; returnQty: number } } = {};
                        viewingReceipt?.items.forEach((item) => {
                          allDeselected[item.productCode] = {
                            selected: false,
                            returnQty: 1,
                          };
                        });
                        setSelectedItems(allDeselected);
                        setExchangeItems({});
                        toast.success(t('returns.allDeselected'));
                      }}
                    >
                      {t('returns.cancelAll')}
                    </Button>
                  </div>
                </div>
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12"></TableHead>
                        <TableHead>{t('returns.product')}</TableHead>
                        <TableHead className="text-center">{t('returns.price')}</TableHead>
                        <TableHead className="text-center">{t('returns.quantityPurchased')}</TableHead>
                        <TableHead className="text-center">{t('returns.quantityReturn')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {viewingReceipt.items.map((item) => {
                        const isSelected = selectedItems[item.productCode]?.selected || false;
                        const returnQty = selectedItems[item.productCode]?.returnQty || 1;

                        return (
                          <>
                            <TableRow key={item.productCode}>
                              <TableCell>
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) =>
                                    handleItemSelect(item.productCode, checked as boolean, item.quantity)
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <div>
                                  <p className="font-medium">{item.productName}</p>
                                  <p className="text-xs text-muted-foreground">{t('returns.code')}: {item.productCode}</p>
                                </div>
                              </TableCell>
                              <TableCell className="text-center data-number">฿{item.price}</TableCell>
                              <TableCell className="text-center data-number">{item.quantity}</TableCell>
                              <TableCell className="text-center">
                                {isSelected ? (
                                  <Select
                                    value={returnQty.toString()}
                                    onValueChange={(value) =>
                                      handleQuantityChange(item.productCode, parseInt(value), item.quantity)
                                    }
                                  >
                                    <SelectTrigger className="w-24 mx-auto">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {Array.from({ length: item.quantity }, (_, i) => i + 1).map((num) => (
                                        <SelectItem key={num} value={num.toString()}>
                                          {num}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </TableCell>
                            </TableRow>

                            {/* Exchange Products Section - Show under selected item */}
                            {isSelected && (
                              <TableRow key={`${item.productCode}-exchange`} className="bg-secondary/10">
                                <TableCell colSpan={5} className="p-4">
                                  <div className="space-y-3">
                                    <Label className="text-sm font-semibold text-muted-foreground">
                                      {t('returns.selectExchange')}
                                    </Label>

                                    {/* Add exchange product form */}
                                    <div className="flex gap-2">
                                      <div className="flex-1">
                                        <Select
                                          value={selectedExchangeProduct}
                                          onValueChange={setSelectedExchangeProduct}
                                        >
                                          <SelectTrigger>
                                            <SelectValue placeholder={t('common.selectProduct')} />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {availableProducts.map((product) => (
                                              <SelectItem key={product.productCode} value={product.productCode}>
                                                <span className="data-number">{product.productName} (฿{product.price}) - {t('store.stock')} {product.quantity}</span>
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div className="w-24">
                                        <Select
                                          value={selectedExchangeQuantity}
                                          onValueChange={setSelectedExchangeQuantity}
                                          disabled={!selectedExchangeProduct}
                                        >
                                          <SelectTrigger>
                                            <SelectValue placeholder={t('common.quantity')} />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {selectedExchangeProduct && (() => {
                                              const product = availableProducts.find(p => p.productCode === selectedExchangeProduct);
                                              const maxQty = Math.min(product?.quantity || 0, 20);
                                              return Array.from({ length: maxQty }, (_, i) => i + 1).map((num) => (
                                                <SelectItem key={num} value={num.toString()}>
                                                  {num}
                                                </SelectItem>
                                              ));
                                            })()}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <Button
                                        type="button"
                                        size="icon"
                                        disabled={!selectedExchangeProduct}
                                        onClick={() => {
                                          if (selectedExchangeProduct) {
                                            setExchangeItems({
                                              ...exchangeItems,
                                              [selectedExchangeProduct]: {
                                                productCode: selectedExchangeProduct,
                                                quantity: parseInt(selectedExchangeQuantity),
                                              },
                                            });
                                            setSelectedExchangeProduct("");
                                            setSelectedExchangeQuantity("1");
                                            toast.success(t('returns.addProduct'));
                                          }
                                        }}
                                      >
                                        <Plus className="h-4 w-4" />
                                      </Button>
                                    </div>

                                    {/* List of selected exchange products */}
                                    {Object.keys(exchangeItems).length > 0 && (
                                      <div className="space-y-2">
                                        <Label className="text-xs text-muted-foreground">{t('returns.selectedProducts')}:</Label>
                                        {Object.entries(exchangeItems).map(([productCode, data]) => {
                                          const product = availableProducts.find(p => p.productCode === productCode);
                                          if (!product) return null;
                                          return (
                                            <div key={productCode} className="flex items-center justify-between p-2 border rounded-lg bg-background">
                                              <div className="flex-1">
                                                <p className="text-sm font-medium">{product.productName}</p>
                                                <p className="text-xs text-muted-foreground">
                                                  <span className="data-number">{t('common.quantity')}: {data.quantity} × ฿{product.price} = ฿{(data.quantity * product.price).toFixed(2)}</span>
                                                </p>
                                              </div>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => {
                                                  const newExchangeItems = { ...exchangeItems };
                                                  delete newExchangeItems[productCode];
                                                  setExchangeItems(newExchangeItems);
                                                  toast.success(t('returns.removeProduct'));
                                                }}
                                              >
                                                <X className="h-3 w-3" />
                                              </Button>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Price Difference Calculation - Only show if there are selected return items */}
              {Object.values(selectedItems).some(item => item.selected) && <Separator />}
              {Object.values(selectedItems).some(item => item.selected) && (() => {
                const returnTotal = Object.entries(selectedItems)
                  .filter(([_, data]) => data.selected)
                  .reduce((sum, [productCode, data]) => {
                    const item = viewingReceipt?.items.find((i) => i.productCode === productCode);
                    return sum + (item ? item.price * data.returnQty : 0);
                  }, 0);

                const exchangeTotal = Object.entries(exchangeItems).reduce((sum, [productCode, data]) => {
                  const product = availableProducts.find((p) => p.productCode === productCode);
                  return sum + (product ? product.price * data.quantity : 0);
                }, 0);

                const difference = exchangeTotal - returnTotal;

                return (
                  <div className="bg-secondary p-4 rounded-lg space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('returns.returnValue')}:</span>
                      <span className="font-semibold data-number">฿{returnTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('returns.exchangeValue')}:</span>
                      <span className="font-semibold data-number">฿{exchangeTotal.toFixed(2)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between text-lg font-bold">
                      <span>
                        {difference > 0 ? t('returns.customerPay') + ":" : difference < 0 ? t('returns.refundCustomer') + ":" : t('returns.noDifference') + ":"}
                      </span>
                      <span className={`data-number ${difference > 0 ? "text-destructive" : difference < 0 ? "text-success" : "text-primary"}`}>
                        ฿{Math.abs(difference).toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {Object.values(selectedItems).some(item => item.selected) && <Separator />}

              <div>
                <Label htmlFor="editReason">{t('returns.reason')}</Label>
                <Textarea
                  id="editReason"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  rows={4}
                  className="mt-1.5"
                  placeholder={t('returns.enterReason')}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsEditDialogOpen(false);
              setSelectedItems({});
              setViewingReceipt(null);
              setExchangeItems({});
            }}>
              {t('returns.cancel')}
            </Button>
            <Button onClick={() => handleUpdateReturn("refund")} variant="secondary">
              {t('returns.requestRefund')}
            </Button>
            <Button onClick={() => handleUpdateReturn("exchange")}>
              {t('returns.saveExchange')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  <Badge variant="secondary">{getPaymentMethodLabel(viewingReceipt.paymentMethod)}</Badge>
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

      {/* Refund Method Selection Dialog */}
      <Dialog open={isRefundMethodDialogOpen} onOpenChange={setIsRefundMethodDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('returns.selectRefundMethod')}</DialogTitle>
            <DialogDescription>
              {t('returns.selectRefundMethodDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-6">
            <Button
              onClick={() => handleRefundMethodSelect("cash")}
              variant="outline"
              className="h-32 flex flex-col items-center justify-center gap-3 hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              <svg
                className="w-12 h-12"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <span className="text-lg font-semibold">{t('returns.refundByCash')}</span>
            </Button>
            <Button
              onClick={() => handleRefundMethodSelect("card")}
              variant="outline"
              className="h-32 flex flex-col items-center justify-center gap-3 hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              <CreditCard className="w-12 h-12" />
              <span className="text-lg font-semibold">{t('returns.refundByCard')}</span>
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRefundMethodDialogOpen(false)}>
              {t('returns.cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cash Refund Confirmation Dialog */}
      <Dialog open={isCashRefundConfirmOpen} onOpenChange={setIsCashRefundConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('returns.confirmCashRefund')}</DialogTitle>
            <DialogDescription>
              {t('returns.confirmCashRefundDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-6">
            {viewingReceipt && (() => {
              const returnTotal = Object.entries(selectedItems)
                .filter(([_, data]) => data.selected)
                .reduce((sum, [productCode, data]) => {
                  const item = viewingReceipt?.items.find((i) => i.productCode === productCode);
                  return sum + (item ? item.price * data.returnQty : 0);
                }, 0);

              const exchangeTotal = Object.entries(exchangeItems).reduce((sum, [productCode, data]) => {
                const product = availableProducts.find((p) => p.productCode === productCode);
                return sum + (product ? product.price * data.quantity : 0);
              }, 0);

              const refundAmount = returnTotal - exchangeTotal;

              return (
                <div className="space-y-4">
                  <div className="bg-secondary p-4 rounded-lg">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-muted-foreground">{t('returns.returnValue')}:</span>
                      <span className="font-semibold data-number">฿{returnTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-muted-foreground">{t('returns.exchangeValue')}:</span>
                      <span className="font-semibold data-number">฿{exchangeTotal.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="bg-primary/10 p-6 rounded-lg">
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground mb-2">{t('returns.refundAmount')}</p>
                      <p className="text-4xl font-bold text-primary data-number">฿{refundAmount.toFixed(2)}</p>
                    </div>
                  </div>

                  <div className="bg-warning/10 border border-warning/30 p-3 rounded-lg">
                    <p className="text-sm text-center">
                      <svg className="inline w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      กรุณาเตรียมเงินสดเพื่อคืนให้ลูกค้า
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCashRefundConfirmOpen(false)}>
              {t('returns.cancel')}
            </Button>
            <Button onClick={handleConfirmCashRefund}>
              {t('returns.confirmRefund')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Card Tap Confirmation Dialog */}
      <Dialog open={isCardTapDialogOpen} onOpenChange={setIsCardTapDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center">
              {cardTapStep === "success" ? t('returns.success') : t('returns.tapCard')}
            </DialogTitle>
            {cardTapStep !== "success" && (
              <DialogDescription className="text-center font-semibold text-base">
                {transactionType === "refund" ? t('returns.refundTransaction') : t('returns.exchangeTransaction')}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="flex flex-col items-center justify-center py-6">
            {cardTapStep !== "success" ? (
              <>
                <div className="w-24 h-24 mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                  <CreditCard className={`w-12 h-12 text-primary ${cardTapStep === "processing" ? "animate-pulse" : ""}`} />
                </div>
                <p className="text-center text-sm text-muted-foreground mb-3">
                  แตะบัตรนักเรียน หรือพิมพ์ UID / รหัสนักเรียน
                </p>
                <input
                  ref={cardInputRef}
                  type="text"
                  autoFocus
                  value={cardUidInput}
                  onChange={(e) => {
                    onCardInputChange(e);
                    if (cardLookupError) setCardLookupError(null);
                  }}
                  onKeyDown={onCardInputKeyDown}
                  placeholder="แตะบัตร / 85001 / RFID-xxxx"
                  disabled={cardTapStep === "processing"}
                  className="w-full mb-2 px-3 py-2 border rounded-md text-center font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                />
                {cardLookupError && (
                  <p className="text-xs text-destructive text-center mb-2">{cardLookupError}</p>
                )}
                <Button
                  onClick={() => handleCardTap(cardUidInput)}
                  size="lg"
                  className="w-full"
                  disabled={cardTapStep === "processing" || !cardUidInput.trim()}
                >
                  {cardTapStep === "processing" ? "กำลังตรวจสอบ..." : t('returns.confirmTap')}
                </Button>
              </>
            ) : (
              <>
                <div className="w-32 h-32 mb-6 rounded-full bg-success/10 flex items-center justify-center">
                  <svg
                    className="w-16 h-16 text-success"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <p className="text-center text-lg font-semibold text-success">
                  {t('returns.dataSaved')}
                </p>
                {verifiedCardholder && (
                  <p className="text-center text-sm text-muted-foreground mt-2">
                    {verifiedCardholder.full_name}
                    {verifiedCardholder.customer_code && ` · ${verifiedCardholder.customer_code}`}
                  </p>
                )}
              </>
            )}
          </div>
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
    </div>
  );
};

export default Returns;
