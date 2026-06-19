import { useState, useEffect, useCallback } from "react";
import { useRfidInput } from "@/hooks/useRfidInput";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/ui/date-range-picker";
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
import { RefreshCw, Search, Calendar, Eye, Trash2, Edit, Plus, X, CreditCard, Package, Minus, Printer, ArrowLeftRight } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { InfoCallout } from "@/components/InfoCallout";
import { toast } from "@/components/ui/sonner";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { fmtDateTime } from "@/lib/dateFormat";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
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

interface ReceiptItem {
  productCode: string;
  productName: string;
  quantity: number;
  price: number;
  isBundle?: boolean;
  bundleId?: number | null;
  bundleCode?: string | null;
}

interface ReceiptPayer {
  type: "customer" | "user" | "department" | "unknown";
  label: string;
  id?: number;
}

interface Receipt {
  id: string;
  date: string;
  items: ReceiptItem[];
  total: number;
  // Backend payment_method enum: wallet | card_tap | cash | edc | credit_card |
  // debit_card | department | bank_transfer | other (declared loose here to
  // accept any backend value without breaking the type-check).
  paymentMethod: string;
  studentId?: string;
  studentName?: string;
  payer?: ReceiptPayer;
  edcMaskedCard?: string | null;
}

interface PosReceipt {
  id: number;
  receipt_number: string;
  transaction_date: string;
  payer_label: string | null;
  payer_kind: string | null;
  total: number;
  payment_method: string;
  status: string;
  shop_id: string | null;
}

interface ReturnRequest {
  id: number;
  receiptId: string;
  productCode?: string;
  productName: string;
  bundleId?: number | null;
  quantity: number;
  returnQuantity: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  date: string;
  priceType: "internal" | "normal";
  voidStatus?: "active" | "voided";
  returnStatus?: "no-return" | "partial-return" | "full-return";
}

type ReturnMode = "with-receipt" | "without-receipt";

interface NoReceiptItem {
  productCode: string;
  productName: string;
  unitPrice: number;
  returnQuantity: number;
  shopId: string;
}

const Returns = () => {
  const { t, i18n } = useTranslation();
  const schoolInfo = useSchoolInfo();
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [availableProducts, setAvailableProducts] = useState<ReceiptItem[]>([]);

  // ── Return mode toggle ─────────────────────────────────────────────────────
  const [returnMode, setReturnMode] = useState<ReturnMode>("with-receipt");

  // ── No-receipt return state ────────────────────────────────────────────────
  const [noReceiptItems, setNoReceiptItems] = useState<NoReceiptItem[]>([]);
  const [noReceiptProductSearch, setNoReceiptProductSearch] = useState("");
  const [noReceiptSearchResults, setNoReceiptSearchResults] = useState<ReceiptItem[]>([]);
  const [noReceiptCustomerName, setNoReceiptCustomerName] = useState("");
  const [noReceiptNotes, setNoReceiptNotes] = useState("");
  const [noReceiptReason, setNoReceiptReason] = useState("");

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
  const [selectedItems, setSelectedItems] = useState<{ [key: string]: { selected: boolean; returnQty: number; productCode: string; bundleId: number | null } }>({});
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

  // Refund confirmation dialog — destination is derived from the original
  // receipt (which wallet / card / cash paid). No more method picker.
  const [isRefundConfirmOpen, setIsRefundConfirmOpen] = useState(false);

  // Credit note result dialog — shown after a successful refund
  interface ReturnResult {
    refundAmount: number;
    refundMethod: string;
    refundedTo?: { type: string; label: string; balanceAfter?: number; maskedCard?: string };
    receiptId: string;
    receiptDate: string;
    payerLabel: string;
    returnedItems: Array<{ productCode: string; productName: string; returnQty: number; unitPrice: number }>;
    returnedAt: string;
    reason: string;
  }
  const [returnResult, setReturnResult] = useState<ReturnResult | null>(null);
  const [isCreditNoteDialogOpen, setIsCreditNoteDialogOpen] = useState(false);

  const getPaymentMethodLabel = (method: string | null | undefined) => {
    if (!method) return "—";
    // Backend may send uppercase ("WALLET", "EDC") or lowercase ("qr_promptpay").
    // Normalize, then fall back to legacy Returns-specific labels for backward compatibility.
    const m = method.toLowerCase();
    const legacy: Record<string, string> = {
      student: t('returns.studentCard'),
      qr: t('returns.qrPromptpay'),
      cash: t('returns.cash'),
      department: t('returns.departmentCard'),
    };
    if (legacy[m]) return legacy[m];
    return t(`common.paymentMethods.${m}`, method);
  };

  // ── No-receipt handlers ──────────────────────────────────────────────────
  const handleNoReceiptProductSearch = async (query: string) => {
    setNoReceiptProductSearch(query);
    if (!query.trim() || !currentShopId) {
      setNoReceiptSearchResults([]);
      return;
    }

    try {
      const params = new URLSearchParams({ inStock: "false" });
      if (currentShopId) params.set("shop_id", currentShopId);
      const data = await api.get<{ productCode: string; productName: string; quantity: number; price: number }[]>(`/exchange/products?${params}`);
      const filtered = data.filter(
        (p) =>
          p.productCode.toLowerCase().includes(query.toLowerCase()) ||
          p.productName.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 10);
      setNoReceiptSearchResults(filtered);
    } catch {
      setNoReceiptSearchResults([]);
    }
  };

  const handleAddNoReceiptItem = (product: ReceiptItem) => {
    // Check if already added
    if (noReceiptItems.some((i) => i.productCode === product.productCode)) {
      toast.error(t("returns.itemAlreadyAdded") || "Item already added");
      return;
    }
    setNoReceiptItems([
      ...noReceiptItems,
      {
        productCode: product.productCode,
        productName: product.productName,
        unitPrice: product.price,
        returnQuantity: 1,
        shopId: currentShopId || "",
      },
    ]);
    setNoReceiptProductSearch("");
    setNoReceiptSearchResults([]);
  };

  const handleRemoveNoReceiptItem = (productCode: string) => {
    setNoReceiptItems(noReceiptItems.filter((i) => i.productCode !== productCode));
  };

  const handleNoReceiptQuantityChange = (productCode: string, qty: number) => {
    if (qty < 1) return;
    setNoReceiptItems(
      noReceiptItems.map((i) =>
        i.productCode === productCode ? { ...i, returnQuantity: qty } : i
      )
    );
  };

  const handleSubmitNoReceiptReturn = async () => {
    if (noReceiptItems.length === 0) {
      toast.error(t("returns.errorSelectProducts") || "Please select products to return");
      return;
    }
    if (!noReceiptReason.trim()) {
      toast.error(t("returns.errorEnterReason") || "Please enter a reason");
      return;
    }

    try {
      const created = await api.post<ReturnRequest[] | ReturnRequest>("/returns/create-without-receipt", {
        items: noReceiptItems,
        reason: noReceiptReason.trim(),
        customerName: noReceiptCustomerName.trim() || null,
        notes: noReceiptNotes.trim() || null,
      });
      // Auto-approve immediately
      const ids = Array.isArray(created) ? created.map((r) => r.id) : [created.id];
      await Promise.all(ids.map((id) => api.put(`/returns/${id}`, { status: "approved" }).catch(() => {})));
      toast.success(t("returns.returnSuccess", "คืนสินค้าสำเร็จ"));
      await fetchReturns();

      // Reset form
      setNoReceiptItems([]);
      setNoReceiptReason("");
      setNoReceiptCustomerName("");
      setNoReceiptNotes("");
    } catch (err: any) {
      toast.error(err?.detail || "Failed to create return");
    }
  };

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

  // Compose the per-line key used by selectedItems / returnedQtyMap. Stays
  // stable as long as the (productCode, bundleId) pair is unique within a
  // receipt — which the backend guarantees.
  const itemKey = (item: { productCode: string; bundleId?: number | null }) =>
    `${item.productCode}::${item.bundleId ?? 0}`;

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
          created.map((r) => api.put(`/returns/${r.id}`, { status: "approved" }).catch(() => {}))
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
    setEditReturnQty(returnItem.returnQuantity.toString());
    setEditReason(returnItem.reason);

    // Initialize selected items based on the current return
    const initialSelection: { [key: string]: { selected: boolean; returnQty: number; productCode: string; bundleId: number | null } } = {};
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

  /**
   * Derive what the backend WILL do when a refund is processed for the given
   * receipt. Mirrors `ReturnsService._derive_refund_destination` so the
   * confirmation dialog can show the destination before the call.
   */
  const getRefundDestinationPreview = (
    receipt: Receipt | null,
  ): { type: string; label: string; hint?: string } => {
    if (!receipt) return { type: "cash", label: t('returns.refundDestCash', 'Cash drawer') };
    const pm = receipt.paymentMethod;
    if (pm === "wallet" || pm === "card_tap" || pm === "department") {
      const payer = receipt.payer;
      if (payer && payer.type !== "unknown") {
        const ownerLabel =
          payer.type === "customer"
            ? t('returns.refundDestCustomerWallet', "{{name}}'s wallet", { name: payer.label })
            : payer.type === "user"
              ? t('returns.refundDestUserWallet', "{{name}}'s wallet", { name: payer.label })
              : t('returns.refundDestDeptWallet', '{{name}} department wallet', { name: payer.label });
        return {
          type: `${payer.type}_wallet`,
          label: ownerLabel,
          hint: t('returns.refundDestWalletHint', 'Wallet will be credited automatically'),
        };
      }
      return { type: "wallet", label: t('returns.refundDestWalletGeneric', 'Original wallet') };
    }
    if (pm === "edc" || pm === "credit_card" || pm === "debit_card") {
      return {
        type: "edc_card",
        label: receipt.edcMaskedCard
          ? t('returns.refundDestEdcCard', 'EDC card {{card}}', { card: receipt.edcMaskedCard })
          : t('returns.refundDestEdcGeneric', 'EDC card refund'),
        hint: t('returns.refundDestEdcHint', 'Process the refund on the EDC terminal'),
      };
    }
    return {
      type: pm || "cash",
      label: t('returns.refundDestCash', 'Cash drawer'),
      hint: pm === "cash" ? t('returns.refundDestCashHint', 'Open drawer and refund cash to customer') : undefined,
    };
  };

  /** Build a success toast describing where the refund actually went. */
  const buildRefundSuccessMessage = (result: {
    refundAmount: number;
    refundMethod: string;
    refundedTo?: { type: string; label: string; balanceAfter?: number; maskedCard?: string };
  }): string => {
    const amount = `฿${result.refundAmount.toFixed(2)}`;
    const dest = result.refundedTo;
    if (!dest) {
      return t('returns.refundSuccess', 'Refund processed successfully');
    }
    if (dest.balanceAfter !== undefined) {
      return t(
        'returns.refundSuccessToWallet',
        'Refunded {{amount}} to {{dest}} (new balance ฿{{balance}})',
        {
          amount,
          dest: dest.label,
          balance: dest.balanceAfter.toFixed(2),
        },
      );
    }
    if (dest.type === "edc_card") {
      return t(
        'returns.refundSuccessEdc',
        'Refund of {{amount}} recorded — process on EDC terminal for card {{card}}',
        { amount, card: dest.maskedCard || '****' },
      );
    }
    return t('returns.refundSuccessGeneric', 'Refunded {{amount}} via {{dest}}', {
      amount,
      dest: dest.label,
    });
  };

  /** Build returnItems payload from selectedItems state */
  const buildReturnItems = () =>
    Object.values(selectedItems)
      .filter((d) => d.selected)
      .map((d) => ({
        productCode: d.productCode,
        returnQuantity: d.returnQty,
        bundleId: d.bundleId,
      }));

  /** Build exchangeItems payload from exchangeItems state */
  const buildExchangeItems = () =>
    Object.entries(exchangeItems)
      .filter(([_, d]) => d.productCode)
      .map(([_, d]) => ({ productCode: d.productCode, quantity: d.quantity }));

  const printReturnSlip = (result: ReturnResult) => {
    const isEn = !i18n.language.startsWith("th");
    const locale = isEn ? "en-US" : "th-TH";

    const lbl = isEn ? {
      title: "CREDIT NOTE",
      subtitle: "Return / Credit Note",
      origReceipt: "Original Receipt",
      purchaseDate: "Purchase Date",
      payer: "Payer",
      returnDate: "Return Date",
      reason: "Reason",
      item: "Item",
      qty: "Qty",
      unitPrice: "Unit Price",
      total: "Total",
      refundAmount: "Refund Amount",
      refundMethod: "Refund Method",
      balance: "Balance After",
      footer: "*** This document serves as a credit note ***",
      thanks: "Thank you for your purchase",
    } : {
      title: "CREDIT NOTE",
      subtitle: "ใบคืนสินค้า / ใบแจ้งหนี้ลด",
      origReceipt: "ใบเสร็จเดิม",
      purchaseDate: "วันที่ซื้อ",
      payer: "ผู้ซื้อ",
      returnDate: "วันที่คืน",
      reason: "เหตุผล",
      item: "รายการ",
      qty: "จำนวน",
      unitPrice: "ราคา/ชิ้น",
      total: "รวม",
      refundAmount: "ยอดคืนเงิน",
      refundMethod: "ช่องทางคืน",
      balance: "ยอดคงเหลือ",
      footer: "*** เอกสารนี้ใช้แทนใบลดหนี้ ***",
      thanks: "ขอบคุณที่ใช้บริการ",
    };

    const refundMethodLabel = (() => {
      const dest = result.refundedTo;
      if (!dest) return result.refundMethod;
      if (dest.balanceAfter !== undefined) return `Wallet — ${dest.label}`;
      if (dest.type === "edc_card") return `EDC card ${dest.maskedCard || "****"}`;
      return dest.label || result.refundMethod;
    })();

    const itemRows = result.returnedItems
      .map(
        (item) => `
        <tr>
          <td style="padding:2px 0;">${item.productName}<br><span style="font-size:9px;color:#555">${item.productCode}</span></td>
          <td style="text-align:center;padding:2px 4px;">${item.returnQty}</td>
          <td style="text-align:right;padding:2px 0;">฿${item.unitPrice.toLocaleString()}</td>
          <td style="text-align:right;padding:2px 0;">฿${(item.returnQty * item.unitPrice).toLocaleString()}</td>
        </tr>`,
      )
      .join("");

    const logoHtml = schoolInfo.logoUrl
      ? `<img src="${schoolInfo.logoUrl}" width="48" height="48" style="object-fit:contain;display:block;margin:0 auto 4px"/>`
      : "";

    const html = `<!DOCTYPE html>
<html lang="${isEn ? "en" : "th"}">
<head>
  <meta charset="UTF-8"/>
  <title>Credit Note</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    body { font-family: 'Courier New', Courier, monospace; font-size: 11px; width: 72mm; margin: 0 auto; color: #000; }
    h1 { font-size: 15px; text-align: center; margin: 4px 0 2px; letter-spacing: 2px; }
    h2 { font-size: 11px; text-align: center; margin: 0 0 6px; font-weight: normal; }
    .center { text-align: center; }
    .divider { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; }
    th { font-size: 9px; text-transform: uppercase; border-bottom: 1px solid #000; padding-bottom: 2px; }
    .total-row td { font-weight: bold; font-size: 13px; padding-top: 4px; }
    .meta { font-size: 9px; color: #333; }
    .footer { text-align: center; font-size: 9px; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="center">
    ${logoHtml}
    <div style="font-size:12px;font-weight:bold">${schoolInfo.name || ""}</div>
    ${schoolInfo.address ? `<div style="font-size:9px;color:#555">${schoolInfo.address}</div>` : ""}
    ${schoolInfo.taxId ? `<div style="font-size:9px;color:#555">Tax ID: ${schoolInfo.taxId}</div>` : ""}
    ${schoolInfo.phone ? `<div style="font-size:9px;color:#555">Tel: ${schoolInfo.phone}</div>` : ""}
  </div>
  <h1>${lbl.title}</h1>
  <h2>${lbl.subtitle}</h2>
  <hr class="divider"/>
  <table>
    <tr><td class="meta">${lbl.origReceipt}</td><td style="text-align:right" class="meta">${result.receiptId}</td></tr>
    <tr><td class="meta">${lbl.purchaseDate}</td><td style="text-align:right" class="meta">${result.receiptDate}</td></tr>
    <tr><td class="meta">${lbl.payer}</td><td style="text-align:right" class="meta">${result.payerLabel || "—"}</td></tr>
    <tr><td class="meta">${lbl.returnDate}</td><td style="text-align:right" class="meta">${fmtDateTime(result.returnedAt)}</td></tr>
    <tr><td class="meta">${lbl.reason}</td><td style="text-align:right" class="meta">${result.reason || "—"}</td></tr>
  </table>
  <hr class="divider"/>
  <table>
    <thead>
      <tr>
        <th style="text-align:left">${lbl.item}</th>
        <th style="text-align:center">${lbl.qty}</th>
        <th style="text-align:right">${lbl.unitPrice}</th>
        <th style="text-align:right">${lbl.total}</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>
  <hr class="divider"/>
  <table>
    <tr class="total-row">
      <td>${lbl.refundAmount}</td>
      <td colspan="3" style="text-align:right">฿${result.refundAmount.toFixed(2)}</td>
    </tr>
    <tr>
      <td class="meta">${lbl.refundMethod}</td>
      <td colspan="3" style="text-align:right" class="meta">${refundMethodLabel}</td>
    </tr>
    ${result.refundedTo?.balanceAfter !== undefined ? `<tr><td class="meta">${lbl.balance}</td><td colspan="3" style="text-align:right" class="meta">฿${result.refundedTo.balanceAfter.toFixed(2)}</td></tr>` : ""}
  </table>
  <hr class="divider"/>
  <div class="footer">
    <p>${lbl.footer}</p>
    <p>${lbl.thanks}</p>
  </div>
</body>
</html>`;

    const win = window.open("", "_blank", "width=320,height=600");
    if (!win) {
      toast.error(t("returns.popupBlocked", "Cannot open print window — please allow pop-ups"));
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  };

  const handleConfirmRefund = async () => {
    if (!editingReturn) return;
    try {
      const result = await api.post<{
        refundAmount: number;
        refundMethod: string;
        refundedTo?: { type: string; label: string; balanceAfter?: number; maskedCard?: string };
      }>(`/returns/${editingReturn.id}/refund`, {
        returnItems: buildReturnItems(),
        reason: editReason || editingReturn.reason,
      });

      // Build credit note result for the summary dialog
      const returnedItems = buildReturnItems().map((ri) => {
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
  }, [editingReturn, editReason, buildReturnItems, buildExchangeItems, viewingReceipt, availableProducts]);

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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center text-xl">
              <Package className="h-6 w-6 mr-2 text-primary" />
              {t("returns.returnWithoutReceipt") || "Return Without Receipt"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Shop selector */}
            <div>
              <Label className="text-sm font-semibold">{t("returns.selectShop") || "Select Shop"}</Label>
              <Select
                value={currentShopId || ""}
                onValueChange={(v) => {
                  setCurrentShopId(v);
                  fetchAvailableProducts(v);
                }}
              >
                <SelectTrigger className="mt-1.5 max-w-xs">
                  <SelectValue placeholder={t("returns.selectShopPlaceholder") || "Select shop..."} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="coop">Coop Shop</SelectItem>
                  <SelectItem value="sports">Sports Shop</SelectItem>
                  <SelectItem value="bookstore">Bookstore</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Product search */}
            {currentShopId && (
              <div>
                <Label className="text-sm font-semibold">{t("returns.searchProduct") || "Search Product"}</Label>
                <div className="relative mt-1.5">
                  <Input
                    placeholder={t("returns.searchProductPlaceholder") || "Search by code or name..."}
                    value={noReceiptProductSearch}
                    onChange={(e) => handleNoReceiptProductSearch(e.target.value)}
                    className="max-w-md"
                  />
                  {noReceiptSearchResults.length > 0 && (
                    <div className="absolute z-10 w-full max-w-md mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-y-auto">
                      {noReceiptSearchResults.map((p) => (
                        <div
                          key={p.productCode}
                          className="flex items-center justify-between p-3 hover:bg-muted cursor-pointer border-b last:border-b-0"
                          onClick={() => handleAddNoReceiptItem(p)}
                        >
                          <div>
                            <div className="font-medium">{p.productName}</div>
                            <div className="text-sm text-muted-foreground">{p.productCode}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono">฿{p.price.toLocaleString()}</span>
                            <Plus className="h-4 w-4 text-primary" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Selected items table */}
            {noReceiptItems.length > 0 && (
              <div>
                <Label className="text-sm font-semibold mb-2 block">{t("returns.itemsToReturn") || "Items to Return"}</Label>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("returns.product")}</TableHead>
                      <TableHead className="text-center">{t("returns.price")}</TableHead>
                      <TableHead className="text-center w-32">{t("returns.quantity")}</TableHead>
                      <TableHead className="text-right">{t("returns.subtotal") || "Subtotal"}</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {noReceiptItems.map((item) => (
                      <TableRow key={item.productCode}>
                        <TableCell>
                          <div className="font-medium">{item.productName}</div>
                          <div className="text-sm text-muted-foreground">{item.productCode}</div>
                        </TableCell>
                        <TableCell className="text-center data-number">฿{item.unitPrice.toLocaleString()}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleNoReceiptQuantityChange(item.productCode, item.returnQuantity - 1)}
                              disabled={item.returnQuantity <= 1}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <Input
                              type="number"
                              min="1"
                              value={item.returnQuantity}
                              onChange={(e) =>
                                handleNoReceiptQuantityChange(item.productCode, parseInt(e.target.value) || 1)
                              }
                              className="w-14 h-7 text-center"
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleNoReceiptQuantityChange(item.productCode, item.returnQuantity + 1)}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="text-right data-number font-medium">
                          ฿{(item.unitPrice * item.returnQuantity).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <IconButton
                            tooltip={t("returns.remove") || "Remove"}
                            variant="ghost"
                            onClick={() => handleRemoveNoReceiptItem(item.productCode)}
                          >
                            <X className="h-4 w-4" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Total */}
                <div className="flex justify-end mt-4">
                  <div className="text-lg font-semibold">
                    {t("returns.total")}: ฿{noReceiptItems.reduce((sum, i) => sum + i.unitPrice * i.returnQuantity, 0).toLocaleString()}
                  </div>
                </div>
              </div>
            )}

            {/* Customer info & reason */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-semibold">{t("returns.customerName") || "Customer Name"}</Label>
                <Input
                  placeholder={t("returns.customerNamePlaceholder") || "Optional customer name"}
                  value={noReceiptCustomerName}
                  onChange={(e) => setNoReceiptCustomerName(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label className="text-sm font-semibold">{t("returns.notes") || "Notes"}</Label>
                <Input
                  placeholder={t("returns.notesPlaceholder") || "Optional notes"}
                  value={noReceiptNotes}
                  onChange={(e) => setNoReceiptNotes(e.target.value)}
                  className="mt-1.5"
                />
              </div>
            </div>

            <div>
              <Label className="text-sm font-semibold">{t("returns.reason")} *</Label>
              <Textarea
                placeholder={t("returns.reasonPlaceholder") || "Reason for return"}
                value={noReceiptReason}
                onChange={(e) => setNoReceiptReason(e.target.value)}
                className="mt-1.5"
                rows={2}
              />
            </div>

            {/* Submit button */}
            <div className="flex justify-end">
              <Button
                onClick={handleSubmitNoReceiptReturn}
                disabled={noReceiptItems.length === 0 || !noReceiptReason.trim()}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("returns.submitReturn") || "Submit Return Request"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search Receipt Section (only when with-receipt mode) */}
      {returnMode === "with-receipt" && (
      <>
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
              <Label htmlFor="searchStudent" className="text-sm font-semibold">{t('returns.studentCodeOrName')}</Label>
              <Input
                id="searchStudent"
                placeholder={t('returns.studentCodePlaceholder')}
                value={searchStudent}
                onChange={(e) => setSearchStudent(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label className="text-sm font-semibold">{t('returns.purchaseDate')}</Label>
              <div className="mt-1.5">
                <DateRangePicker
                  startDate={searchDateFrom}
                  endDate={searchDateTo}
                  onStartChange={setSearchDateFrom}
                  onEndChange={setSearchDateTo}
                />
              </div>
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

      {/* Multi-match results — let user pick a receipt */}
      {searchResults.length > 0 && !selectedReceipt && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("returns.searchResultsCount", { count: searchResults.length, defaultValue: "{{count}} receipts found — click to select" })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-3">Date / Time</th>
                    <th className="text-left p-3">Receipt ID</th>
                    <th className="text-left p-3">Payer</th>
                    <th className="text-left p-3">Payment</th>
                    <th className="text-right p-3">Total</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-muted/50">
                      <td className="p-3">{(r as any).date}</td>
                      <td className="p-3 font-mono">{r.id}</td>
                      <td className="p-3">{(r as any).payer?.label || "—"}</td>
                      <td className="p-3">{getPaymentMethodLabel((r as any).paymentMethod)}</td>
                      <td className="p-3 text-right">฿{Number((r as any).total).toFixed(2)}</td>
                      <td className="p-3">
                        <Button size="sm" onClick={() => pickSearchResult(r)}>
                          {t("common.select", "Select")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

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
                      <Badge variant="outline" className="text-xs">{getPaymentMethodLabel(r.payment_method)}</Badge>
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
                <TableHead>{t("returns.buyer")}</TableHead>
                <TableHead>{t('returns.type')}</TableHead>
                <TableHead>{t('returns.paymentMethod')}</TableHead>
                <TableHead className="text-center">{t('returns.returnStatus')}</TableHead>
                <TableHead className="text-center">{t('returns.status')}</TableHead>
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
                      <Badge variant={item.status === "rejected" ? "destructive" : "success"}>
                        {item.status === "rejected" ? t('returns.rejected', 'ปฏิเสธ') : t('returns.returned', 'คืนแล้ว')}
                      </Badge>
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
                        onClick={() => setDeleteReturn(item)}
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
                        const k = itemKey(item);
                        const isSelected = selectedItems[k]?.selected || false;
                        const returnQty = selectedItems[k]?.returnQty || 1;

                        return (
                          <>
                            <TableRow key={k}>
                              <TableCell>
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) =>
                                    handleItemSelect(item, checked as boolean, item.quantity)
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
                                      handleQuantityChange(item, parseInt(value), item.quantity)
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

      {/* Refund Confirmation Dialog — destination derived from original receipt */}
      <Dialog open={isRefundConfirmOpen} onOpenChange={setIsRefundConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('returns.confirmRefund', 'Confirm Refund')}</DialogTitle>
            <DialogDescription>
              {t(
                'returns.confirmRefundDesc',
                'The refund will be returned to the same payment source used on the original receipt.',
              )}
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
              const dest = getRefundDestinationPreview(viewingReceipt);

              return (
                <div className="space-y-4">
                  <div className="bg-secondary p-4 rounded-lg space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">
                        {t('returns.originalPayment', 'Original payment')}:
                      </span>
                      <span className="font-semibold uppercase text-xs">
                        {getPaymentMethodLabel(viewingReceipt.paymentMethod)}
                      </span>
                    </div>
                    {viewingReceipt.payer && viewingReceipt.payer.label && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">
                          {t('returns.paidBy', 'Paid by')}:
                        </span>
                        <span className="font-medium text-sm">{viewingReceipt.payer.label}</span>
                      </div>
                    )}
                  </div>

                  <div className="bg-primary/10 p-6 rounded-lg">
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground mb-2">
                        {t('returns.refundAmount')}
                      </p>
                      <p className="text-4xl font-bold text-primary data-number">
                        ฿{returnTotal.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  <div className="bg-success/10 border border-success/30 p-3 rounded-lg space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t('returns.refundDestination', 'Refund destination')}
                    </p>
                    <p className="text-sm font-semibold">{dest.label}</p>
                    {dest.hint && (
                      <p className="text-xs text-muted-foreground">{dest.hint}</p>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRefundConfirmOpen(false)}>
              {t('returns.cancel')}
            </Button>
            <Button onClick={handleConfirmRefund}>
              {t('returns.confirmRefundAction', 'Confirm Refund')}
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
                  {t("returns.tapCardPrompt", "Tap the student card, or type the UID / student code")}
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
                  placeholder={t("returns.tapCardPlaceholder", "Tap card / 85001 / RFID-xxxx")}
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
                  {cardTapStep === "processing" ? t("returns.verifying", "Verifying…") : t('returns.confirmTap')}
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
              onClick={() => { if (returnResult) printReturnSlip(returnResult); }}
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
