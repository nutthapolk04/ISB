import { useState, useEffect, useCallback, useMemo } from "react";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Receipt, Search, Eye, Download, Loader2, Ban } from "lucide-react";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { IconButton } from "@/components/IconButton";
import { InfoCallout } from "@/components/InfoCallout";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";

// ── Scope constants ──────────────────────────────────────────────────────────

type ModuleScope = "canteen" | "store";
const STORE_SHOPS = ["coop", "sports", "bookstore"] as const;
const CANTEEN_SHOPS = ["canteen", "canteen_thai", "canteen_drinks"] as const;
type StoreShopPick = "all" | (typeof STORE_SHOPS)[number];

// ── Types (match backend ReceiptResponse) ────────────────────────────────────

interface ReceiptOptionsSnapshotApi {
  options_total: number;
  groups: Array<{
    group_id: number;
    name: string;
    selection_type: "single" | "multi" | "quantity";
    options: Array<{
      option_id: number;
      name: string;
      price_delta: number;
      quantity: number;
    }>;
  }>;
}

interface ReceiptItemApi {
  id: number;
  receipt_id: number;
  product_variant_id: number;
  quantity: number;
  unit_price: number;
  discount: number;
  line_total: number;
  options?: ReceiptOptionsSnapshotApi | null;
  created_at: string;
  product_variant?: {
    sku: string | null;
    variant_name: string | null;
    barcode: string | null;
  } | null;
}

interface PayerDetail {
  name: string;
  code: string | null;
  grade: string | null;       // grade for students, dept name for staff
  photo_url: string | null;
  role: string;
  wallet_balance: number | null;
}

interface ReceiptApi {
  id: number;
  receipt_number: string;
  transaction_date: string;
  transaction_mode: string;
  customer_id: number | null;
  payer_user_id?: number | null;
  payer_department_id?: number | null;
  payer_kind?: string | null;
  payer_label?: string | null;
  payer_detail?: PayerDetail | null;
  created_by_name?: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payment_method: string;
  status: string;
  notes: string | null;
  cash_received?: number | null;
  created_at: string;
  created_by: number;
  voided_at: string | null;
  voided_by: number | null;
  voided_reason: string | null;
  items: ReceiptItemApi[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PAYMENT_LABELS_TH: Record<string, string> = {
  cash: "เงินสด",
  credit_card: "บัตรเครดิต",
  debit_card: "บัตรเดบิต",
  wallet: "Wallet",
  bank_transfer: "โอนเงิน",
  qr: "QR PromptPay",
  qr_promptpay: "QR PromptPay",
  edc: "EDC (บัตรเครดิต/เดบิต)",
  department: "หักจากงบแผนก",
  other: "อื่นๆ",
};

const PAYMENT_LABELS_EN: Record<string, string> = {
  cash: "Cash",
  credit_card: "Credit Card",
  debit_card: "Debit Card",
  wallet: "Wallet",
  bank_transfer: "Bank Transfer",
  qr: "QR PromptPay",
  qr_promptpay: "QR PromptPay",
  edc: "EDC (Credit/Debit Card)",
  department: "Budget Deduction",
  other: "Other",
};

const RECEIPT_LABELS = {
  th: {
    htmlLang: "th",
    locale: "th-TH",
    title: "ใบเสร็จ",
    subtitle: "ใบเสร็จรับเงิน / Receipt",
    receiptNo: "เลขที่",
    date: "วันที่",
    payer: "ผู้ชำระ",
    payment: "ชำระด้วย",
    itemDiscount: "ส่วนลด",
    billDiscount: "ส่วนลดท้ายบิล",
    tax: "ภาษี",
    subtotal: "ยอดรวม",
    grandTotal: "รวมสุทธิ",
    balanceBefore: "ยอดก่อนชำระ",
    balanceAfter: "ยอดคงเหลือ",
    voided: "*** ใบเสร็จนี้ถูกยกเลิกแล้ว ***",
    thanks: "ขอบคุณที่ใช้บริการ / Thank you",
    taxId: "เลขภาษี",
    tel: "โทร",
    cashReceived: "รับเงินสด",
    change: "เงินทอน",
  },
  en: {
    htmlLang: "en",
    locale: "en-US",
    title: "Receipt",
    subtitle: "Sales Receipt",
    receiptNo: "Receipt #",
    date: "Date",
    payer: "Payer",
    payment: "Payment",
    itemDiscount: "Discount",
    billDiscount: "Bill Discount",
    tax: "Tax",
    subtotal: "Subtotal",
    grandTotal: "Grand Total",
    balanceBefore: "Balance before",
    balanceAfter: "Balance after",
    voided: "*** THIS RECEIPT HAS BEEN VOIDED ***",
    thanks: "Thank you for your purchase",
    taxId: "Tax ID",
    tel: "Tel",
    cashReceived: "Cash received",
    change: "Change",
  },
};

function fmtDate(iso: string, locale: string = "th-TH"): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function fmtDateOnly(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

// ── Print / PDF ───────────────────────────────────────────────────────────────

const ISB_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="64" height="64" role="img" aria-label="ISB Logo">
  <rect width="512" height="512" fill="#f3f4f6"/>
  <polygon points="256,120 60,300 452,300" fill="#eacb46"/>
  <polygon points="256,158 154,264 358,264" fill="#d4362a"/>
  <polygon points="256,158 358,264 256,264" fill="#b6352a"/>
  <text x="256" y="430" text-anchor="middle" font-family="Times New Roman, serif" font-size="190" fill="#111111">ISB</text>
</svg>`;

import type { SchoolInfo } from "@/contexts/SchoolInfoContext";

function buildReceiptHtml(r: ReceiptApi, school: SchoolInfo, shopName?: string | null, lang: string = "th"): string {
  const isEn = lang.startsWith("en");
  const lbl = isEn ? RECEIPT_LABELS.en : RECEIPT_LABELS.th;
  const paymentMap = isEn ? PAYMENT_LABELS_EN : PAYMENT_LABELS_TH;
  const paymentLabel = paymentMap[r.payment_method] ?? r.payment_method;
  const itemRows = r.items.map((item) => {
    const opts = item.options as { is_bundle?: boolean; bundle_name?: string; groups?: any[] } | null | undefined;
    const isBundle = opts?.is_bundle === true;
    const name = isBundle
      ? (opts?.bundle_name ?? "Bundle")
      : item.product_variant?.variant_name ?? `Product #${item.product_variant_id}`;
    const optionLines = !isBundle && opts?.groups
      ? opts.groups.flatMap((g: any) =>
          g.options.map((o: any) => {
            const price = o.price_delta > 0 ? ` +฿${(o.price_delta * o.quantity).toLocaleString()}` : "";
            return `<div class="opt">+ ${o.name}${o.quantity > 1 ? ` ×${o.quantity}` : ""}${price}</div>`;
          }),
        ).join("")
      : "";
    const discountLine = item.discount > 0
      ? `<div class="row disc"><span>${lbl.itemDiscount}</span><span>-฿${item.discount.toLocaleString()}</span></div>`
      : "";
    return `
      <div class="row">
        <span>${name} ×${item.quantity}</span>
        <span>฿${item.line_total.toLocaleString()}</span>
      </div>
      ${optionLines}
      ${discountLine}`;
  }).join("");

  const discountSection = r.discount > 0
    ? `<div class="row small"><span>${lbl.billDiscount}</span><span>-฿${r.discount.toLocaleString()}</span></div>`
    : "";
  const taxSection = r.tax > 0
    ? `<div class="row small"><span>${lbl.tax}</span><span>฿${r.tax.toLocaleString()}</span></div>`
    : "";
  const payerSection = r.payer_label
    ? `<div class="row small"><span>${lbl.payer}</span><span>${r.payer_label}</span></div>`
    : "";
  const voidedSection = r.status !== "active"
    ? `<div class="voided">${lbl.voided}</div>`
    : "";

  const walletBalanceAfter = r.payer_detail?.wallet_balance ?? null;
  const balanceBeforeSection =
    r.payment_method === "wallet" && walletBalanceAfter !== null
      ? `<div class="row small"><span>${lbl.balanceBefore}</span><span>฿${(walletBalanceAfter + r.total).toLocaleString(lbl.locale, { minimumFractionDigits: 2 })}</span></div>`
      : "";
  const balanceAfterSection =
    r.payment_method === "wallet" && walletBalanceAfter !== null
      ? `<div class="row balance-after"><span>${lbl.balanceAfter}</span><span>฿${walletBalanceAfter.toLocaleString(lbl.locale, { minimumFractionDigits: 2 })}</span></div>`
      : "";
  const cashSection =
    r.payment_method === "cash" && r.cash_received != null
      ? `<div class="row small"><span>${lbl.cashReceived}</span><span>฿${Number(r.cash_received).toLocaleString(lbl.locale, { minimumFractionDigits: 2 })}</span></div>
         <div class="row small" style="font-weight:bold;color:#059669"><span>${lbl.change}</span><span>฿${Math.max(0, Number(r.cash_received) - r.total).toLocaleString(lbl.locale, { minimumFractionDigits: 2 })}</span></div>`
      : "";

  const shopLine = shopName
    ? `<p class="sub" style="font-weight:600;color:#111;">${shopName}</p>`
    : "";
  const logoHtml = school.logoUrl
    ? `<img src="${school.logoUrl}" width="64" height="64" style="object-fit:contain;" />`
    : ISB_LOGO_SVG;
  const addressLine = school.address
    ? `<p class="sub">${school.address}</p>`
    : "";
  const taxPhoneLine = (school.taxId || school.phone)
    ? `<p class="sub">${school.taxId ? `${lbl.taxId}: ${school.taxId}` : ""}${school.taxId && school.phone ? " | " : ""}${school.phone ? `${lbl.tel}: ${school.phone}` : ""}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="${lbl.htmlLang}">
<head>
<meta charset="UTF-8" />
<title>${lbl.title} ${r.receipt_number}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Courier New', monospace; font-size: 12px;
         width: 80mm; margin: 0 auto; padding: 8px; color: #111; }
  .logo-wrap { display: flex; justify-content: center; margin-bottom: 4px; }
  h1 { text-align: center; font-size: 15px; margin-bottom: 2px; }
  .center { text-align: center; }
  .sub { font-size: 11px; color: #555; text-align: center; margin-bottom: 3px; }
  hr { border: none; border-top: 1px dashed #888; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; margin: 2px 0; }
  .row span:last-child { text-align: right; white-space: nowrap; padding-left: 6px; }
  .opt { padding-left: 12px; font-size: 11px; color: #666; }
  .disc { color: #c00; font-size: 11px; }
  .small { font-size: 11px; color: #555; }
  .total { font-size: 15px; font-weight: bold; margin-top: 4px; }
  .balance-after { font-size: 16px; font-weight: bold; color: #1d4ed8; margin-top: 6px; }
  .voided { text-align: center; color: #c00; font-weight: bold;
             font-size: 13px; margin: 6px 0; border: 1px solid #c00; padding: 3px; }
  @media print { @page { margin: 0; size: 80mm auto; } }
</style>
</head>
<body>
  <div class="logo-wrap">${logoHtml}</div>
  <h1>${school.name}</h1>
  ${addressLine}
  ${taxPhoneLine}
  ${shopLine}
  <p class="sub">${lbl.subtitle}</p>
  ${voidedSection}
  <hr/>
  <div class="row"><span>${lbl.receiptNo}</span><span>${r.receipt_number}</span></div>
  <div class="row small"><span>${lbl.date}</span><span>${fmtDate(r.transaction_date, lbl.locale)}</span></div>
  ${payerSection}
  <div class="row small"><span>${lbl.payment}</span><span>${paymentLabel}</span></div>
  <hr/>
  ${itemRows}
  <hr/>
  ${balanceBeforeSection}
  <div class="row small"><span>${lbl.subtotal}</span><span>฿${r.subtotal.toLocaleString()}</span></div>
  ${discountSection}
  ${taxSection}
  <div class="row total"><span>${lbl.grandTotal}</span><span>฿${r.total.toLocaleString()}</span></div>
  ${balanceAfterSection}
  ${cashSection ? `<hr/>${cashSection}` : ""}
  <hr/>
  <p class="center sub">${lbl.thanks}</p>
</body>
</html>`;
}

function printReceipt(r: ReceiptApi, school: SchoolInfo, shopName?: string | null, lang: string = "th"): void {
  const win = window.open("", "_blank", "width=400,height=640");
  if (!win) return;
  win.document.write(buildReceiptHtml(r, school, shopName, lang));
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 300);
}

// ── Component ────────────────────────────────────────────────────────────────

const Receipts = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const schoolInfo = useSchoolInfo();

  // ── Module scope detection (from URL) ───────────────────────────────────
  const moduleScope: ModuleScope = pathname.startsWith("/canteen")
    ? "canteen"
    : "store";

  const [receipts, setReceipts] = useState<ReceiptApi[]>([]);
  const [loading, setLoading] = useState(true);

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
  const [voidReason, setVoidReason] = useState("");
  const [voidLoading, setVoidLoading] = useState(false);

  const canVoid = user?.role === "admin" || user?.role === "manager" || user?.role === "cashier";

  const handleVoidConfirm = async () => {
    if (!voidTarget) return;
    setVoidLoading(true);
    try {
      const updated = await api.post<ReceiptApi>(`/pos/void/${voidTarget.id}`, {
        reason: voidReason.trim() || null,
      });
      setReceipts((prev) => prev.map((r) => r.id === updated.id ? updated : r));
      toast.success(t("receipts.voidDialog.successToast", { number: voidTarget.receipt_number }));
      setVoidTarget(null);
      setVoidReason("");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : t("receipts.voidDialog.failToast"));
    } finally {
      setVoidLoading(false);
    }
  };
  // Admin-only picker for store scope (coop / sports / bookstore / all)
  const [pickedStoreShop, setPickedStoreShop] = useState<StoreShopPick>("all");

  // ── Build shop-scope query params ───────────────────────────────────────
  const queryParams = useMemo(() => {
    if (moduleScope === "canteen") {
      // manager / cashier on a specific kitchen: lock to their own shop
      if (user?.shopId) return `?shop_id=${user.shopId}`;
      // admin / superuser: aggregate all canteen kitchens
      return `?shop_ids=${CANTEEN_SHOPS.join(",")}`;
    }
    // Store scope
    if (user?.role === "admin") {
      return pickedStoreShop === "all"
        ? `?shop_ids=${STORE_SHOPS.join(",")}`
        : `?shop_id=${pickedStoreShop}`;
    }
    // manager / cashier on store: lock to their own shop
    return user?.shopId ? `?shop_id=${user.shopId}` : "";
  }, [moduleScope, user, pickedStoreShop]);

  // ── Fetch receipts from API ─────────────────────────────────────────────
  const fetchReceipts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<ReceiptApi[]>(`/pos/receipt${queryParams}`);
      setReceipts(data);
    } catch {
      // silent — user may not have token yet, or backend may ignore the filter
    } finally {
      setLoading(false);
    }
  }, [queryParams]);

  useEffect(() => { fetchReceipts(); }, [fetchReceipts]);

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
    if (paymentType !== "all" && r.payment_method !== paymentType) return false;
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

  const totalSales = receipts
    .filter((r) => r.status === "active")
    .reduce((s, r) => s + r.total, 0);

  const todayStr = new Date().toISOString().slice(0, 10);
  const todaySales = receipts
    .filter((r) => r.status === "active" && fmtDateOnly(r.transaction_date) === todayStr)
    .reduce((s, r) => s + r.total, 0);

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
            {moduleScope === "store" && user?.role === "admin" && (
              <Select
                value={pickedStoreShop}
                onValueChange={(v) => setPickedStoreShop(v as StoreShopPick)}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("receipts.storeShopAll")}</SelectItem>
                  <SelectItem value="coop">{t("receipts.storeShopCoop")}</SelectItem>
                  <SelectItem value="sports">{t("receipts.storeShopSports")}</SelectItem>
                  <SelectItem value="bookstore">{t("receipts.storeShopBookstore")}</SelectItem>
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

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="kpi-card">
          <CardHeader>
            <CardTitle className="kpi-label">{t("receipts.totalSales")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="kpi-value text-primary">฿{totalSales.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="kpi-card">
          <CardHeader>
            <CardTitle className="kpi-label">{t("receipts.receiptCount")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="kpi-value">{receipts.length}</p>
          </CardContent>
        </Card>
        <Card className="kpi-card">
          <CardHeader>
            <CardTitle className="kpi-label">{t("receipts.todaySales")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="kpi-value text-success">฿{todaySales.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Search Panel ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">{t("receipts.searchPanel.title", "Search Receipt")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Receipt ID */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("receipts.searchPanel.receiptId", "Receipt ID")}
              </label>
              <Input
                placeholder="R-001"
                value={searchReceiptId}
                onChange={(e) => setSearchReceiptId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>

            {/* Payer name / code */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("receipts.searchPanel.payer", "รหัส/ชื่อนักเรียน")}
              </label>
              <Input
                placeholder={t("receipts.searchPanel.payerPlaceholder")}
                value={searchPayer}
                onChange={(e) => setSearchPayer(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>

            {/* Purchase Date Range */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("receipts.searchPanel.date", "Purchase Date")}
              </label>
              <DateRangePicker
                startDate={searchDateFrom}
                endDate={searchDateTo}
                onStartChange={setSearchDateFrom}
                onEndChange={setSearchDateTo}
              />
            </div>

            {/* Payment Type */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("receipts.searchPanel.paymentType", "Payment Type")}
              </label>
              <Select value={searchPaymentType} onValueChange={setSearchPaymentType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("receipts.searchPanel.allTypes", "All")}</SelectItem>
                  <SelectItem value="wallet">{t("common.paymentMethods.wallet")}</SelectItem>
                  <SelectItem value="cash">{t("common.paymentMethods.cash")}</SelectItem>
                  <SelectItem value="qr">{t("common.paymentMethods.qr")}</SelectItem>
                  <SelectItem value="qr_promptpay">{t("common.paymentMethods.qr_promptpay")}</SelectItem>
                  <SelectItem value="credit_card">{t("common.paymentMethods.credit_card")}</SelectItem>
                  <SelectItem value="debit_card">{t("common.paymentMethods.debit_card")}</SelectItem>
                  <SelectItem value="edc">{t("common.paymentMethods.edc")}</SelectItem>
                  <SelectItem value="bank_transfer">{t("common.paymentMethods.bank_transfer")}</SelectItem>
                  <SelectItem value="other">{t("common.paymentMethods.other")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 mt-4">
            {hasActiveSearch && (
              <Button variant="ghost" size="sm" onClick={handleClearSearch} className="text-muted-foreground">
                {t("receipts.searchPanel.clear", "ล้างตัวกรอง")}
              </Button>
            )}
            <Button
              onClick={handleSearch}
              className="bg-orange-500 hover:bg-orange-600 text-white gap-2"
            >
              <Search className="h-4 w-4" />
              {t("receipts.searchPanel.search", "Search Receipt")}
            </Button>
          </div>

          {/* Active filter chips */}
          {hasActiveSearch && (
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t">
              <span className="text-xs text-muted-foreground self-center">
                {t("receipts.searchPanel.filtering", "กรอง:")}
              </span>
              {appliedSearch.receiptId && (
                <span className="inline-flex items-center rounded-full bg-orange-100 text-orange-700 text-xs px-2 py-0.5">
                  ID: {appliedSearch.receiptId}
                </span>
              )}
              {appliedSearch.payer && (
                <span className="inline-flex items-center rounded-full bg-orange-100 text-orange-700 text-xs px-2 py-0.5">
                  {t("receipts.searchPanel.chipPayer")}: {appliedSearch.payer}
                </span>
              )}
              {(appliedSearch.dateFrom || appliedSearch.dateTo) && (
                <span className="inline-flex items-center rounded-full bg-orange-100 text-orange-700 text-xs px-2 py-0.5">
                  {t("receipts.searchPanel.chipDate")}: {appliedSearch.dateFrom || "…"} → {appliedSearch.dateTo || "…"}
                </span>
              )}
              {appliedSearch.paymentType !== "all" && (
                <span className="inline-flex items-center rounded-full bg-orange-100 text-orange-700 text-xs px-2 py-0.5">
                  {t("receipts.paymentMethod")}: {t(`common.paymentMethods.${appliedSearch.paymentType}`, appliedSearch.paymentType)}
                </span>
              )}
              <span className="text-xs text-muted-foreground self-center ml-1">
                ({filteredReceipts.length} {t("receipts.searchPanel.results", "รายการ")})
              </span>
            </div>
          )}
        </CardContent>
      </Card>

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
                    <TableCell className="text-sm">{receipt.created_by_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {t(`common.paymentMethods.${receipt.payment_method}`, receipt.payment_method)}
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
                          onClick={() => printReceipt(receipt, schoolInfo, user?.shopName)}
                        >
                          <Download className="h-4 w-4" />
                        </IconButton>
                        {canVoid && receipt.status === "active" && (
                          <IconButton
                            tooltip={t("receipts.void", "Void")}
                            onClick={() => {
                              setVoidTarget(receipt);
                              setVoidReason("");
                            }}
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
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                  .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === "…" ? (
                      <span key={`ellipsis-${i}`} className="text-xs px-1 text-muted-foreground">…</span>
                    ) : (
                      <Button
                        key={p}
                        variant={safePage === p ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCurrentPage(p as number)}
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

      {/* ── Void Confirmation Dialog ─────────────────────────────────────── */}
      <Dialog open={!!voidTarget} onOpenChange={(v) => { if (!v && !voidLoading) setVoidTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Ban className="h-5 w-5" />
              {t("receipts.voidDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {voidTarget?.receipt_number} · ฿{voidTarget?.total.toLocaleString()}
              {" "}— {t("receipts.voidDialog.walletRefundNote")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium">{t("receipts.voidDialog.reasonLabel")}</label>
              {/* Preset reason chips */}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {([
                  "incorrect_transaction",
                  "customer_changed_mind",
                  "out_of_stock",
                  "incorrect_price",
                  "duplicate_payment",
                  "test_transaction",
                ] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    disabled={voidLoading}
                    onClick={() => setVoidReason(t(`receipts.voidDialog.reasons.${key}`))}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition",
                      voidReason === t(`receipts.voidDialog.reasons.${key}`)
                        ? "border-destructive bg-destructive/10 text-destructive font-semibold"
                        : "border-border bg-muted/50 text-muted-foreground hover:border-destructive/50 hover:text-foreground",
                    )}
                  >
                    {t(`receipts.voidDialog.reasons.${key}`)}
                  </button>
                ))}
              </div>
              <Textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder={t("receipts.voidDialog.reasonPlaceholder")}
                rows={2}
                className="mt-2 resize-none"
                disabled={voidLoading}
              />
            </div>
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
              {t("receipts.voidDialog.irreversible")}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setVoidTarget(null)}
              disabled={voidLoading}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleVoidConfirm}
              disabled={voidLoading}
            >
              {voidLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("receipts.voidDialog.confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Receipt Detail Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Receipt className="h-5 w-5 mr-2" />
              {t("receipts.details")}
            </DialogTitle>
            <DialogDescription>
              {t("receipts.receiptId")}: {selectedReceipt?.receipt_number}
            </DialogDescription>
          </DialogHeader>
          {selectedReceipt && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">{t("receipts.dateTime")}:</span>
                  <span className="text-sm font-medium">{fmtDate(selectedReceipt.transaction_date)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">{t("receipts.paymentMethod")}:</span>
                  <span className="text-sm font-semibold">
                    {t(`common.paymentMethods.${selectedReceipt.payment_method}`, selectedReceipt.payment_method)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">{t("receipts.status", "Status")}:</span>
                  <Badge variant={selectedReceipt.status === "active" ? "success" : "destructive"}>
                    {selectedReceipt.status === "active" ? "Active" : "Voided"}
                  </Badge>
                </div>
                {selectedReceipt.notes && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Notes:</span>
                    <span className="text-sm">{selectedReceipt.notes}</span>
                  </div>
                )}
                {selectedReceipt.voided_reason && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Void reason:</span>
                    <span className="text-sm text-destructive">{selectedReceipt.voided_reason}</span>
                  </div>
                )}
              </div>
              <Separator />

              {/* ── Buyer card (wallet payment only) ───────────────────── */}
              {selectedReceipt.payer_detail && (
                <>
                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 flex items-center gap-3">
                    {/* Photo */}
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-blue-100 flex items-center justify-center">
                      {selectedReceipt.payer_detail.photo_url ? (
                        <img
                          src={selectedReceipt.payer_detail.photo_url}
                          alt={selectedReceipt.payer_detail.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-xl text-blue-400 font-bold">
                          {selectedReceipt.payer_detail.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm truncate">
                        {selectedReceipt.payer_detail.name}
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {selectedReceipt.payer_detail.code && (
                          <div>{t("receipts.searchPanel.detailCode")}: <span className="font-mono">{selectedReceipt.payer_detail.code}</span></div>
                        )}
                        {selectedReceipt.payer_detail.grade && (
                          <div>
                            {selectedReceipt.payer_detail.role === "student" ? `${t("receipts.searchPanel.detailGrade")}: ` : `${t("receipts.searchPanel.detailDept")}: `}
                            {selectedReceipt.payer_detail.grade}
                          </div>
                        )}
                        <div className="capitalize text-blue-600 font-medium">
                          {selectedReceipt.payer_detail.role}
                        </div>
                      </div>
                    </div>
                    {/* Wallet balance */}
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-muted-foreground">{t("receipts.balance", "Balance")}</div>
                      <div className={cn(
                        "text-base font-bold tabular-nums",
                        (selectedReceipt.payer_detail.wallet_balance ?? 0) < 0
                          ? "text-destructive"
                          : "text-emerald-600",
                      )}>
                        {selectedReceipt.payer_detail.wallet_balance !== null
                          ? `฿${selectedReceipt.payer_detail.wallet_balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                          : "—"}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{t("receipts.afterPayment", "After payment")}</div>
                    </div>
                  </div>
                  <Separator />
                </>
              )}

              <div className="space-y-2">
                <h4 className="font-semibold">{t("receipts.productList")}</h4>
                {selectedReceipt.items.map((item) => {
                  const gross = item.line_total;
                  const hasItemDiscount = item.discount > 0;
                  const opts = item.options as { is_bundle?: boolean; bundle_name?: string; groups?: any[] } | null | undefined;
                  const isBundle = opts?.is_bundle === true;
                  const displayName = isBundle
                    ? (opts?.bundle_name ?? "Bundle")
                    : item.product_variant?.variant_name ?? `Product #${item.product_variant_id}`;
                  return (
                    <div key={item.id} className="text-sm">
                      <div className="flex justify-between">
                        <span>
                          {displayName} x {item.quantity}
                        </span>
                        <span className="data-number">฿{gross.toLocaleString()}</span>
                      </div>
                      {!isBundle && opts?.groups && opts.groups.length > 0 && (
                        <div className="pl-4 pt-0.5 space-y-0.5 text-xs text-muted-foreground">
                          {opts.groups.flatMap((g: any) =>
                            g.options.map((o: any) => (
                              <div
                                key={`${g.group_id}-${o.option_id}`}
                                className="flex justify-between"
                              >
                                <span>
                                  + {o.name}
                                  {o.quantity > 1 && ` ×${o.quantity}`}
                                </span>
                                {o.price_delta > 0 && (
                                  <span className="data-number">
                                    +฿{(o.price_delta * o.quantity).toLocaleString()}
                                  </span>
                                )}
                              </div>
                            )),
                          )}
                        </div>
                      )}
                      {hasItemDiscount && (
                        <div className="flex justify-between text-destructive text-xs pl-4">
                          <span>{t("receipts.itemDiscount", "ส่วนลด")}</span>
                          <span className="data-number">-฿{item.discount.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <Separator />

              {/* Totals breakdown */}
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("receipts.subtotal", "ยอดรวมก่อนส่วนลด")}</span>
                  <span className="data-number">฿{selectedReceipt.subtotal.toLocaleString()}</span>
                </div>
                {selectedReceipt.discount > 0 && (
                  <div className="flex justify-between text-destructive">
                    <span>{t("receipts.billDiscount", "ส่วนลดท้ายบิล")}</span>
                    <span className="data-number">-฿{selectedReceipt.discount.toLocaleString()}</span>
                  </div>
                )}
                {selectedReceipt.tax > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("receipts.tax", "ภาษี")}</span>
                    <span className="data-number">฿{selectedReceipt.tax.toLocaleString()}</span>
                  </div>
                )}
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span>{t("receipts.grandTotal")}</span>
                <span className="text-primary data-number">
                  ฿{selectedReceipt.total.toLocaleString()}
                </span>
              </div>
              {selectedReceipt.payment_method === "cash" && selectedReceipt.cash_received != null && (
                <div className="rounded-xl border bg-muted/40 p-3 text-sm space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("receipts.cashReceived", "Cash received")}</span>
                    <span className="data-number">
                      ฿{selectedReceipt.cash_received.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between font-semibold border-t pt-1.5">
                    <span>{t("receipts.change", "Change")}</span>
                    <span className="text-emerald-600 data-number">
                      ฿{Math.max(0, selectedReceipt.cash_received - selectedReceipt.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              )}
              <Button className="w-full" variant="outline" onClick={() => printReceipt(selectedReceipt, schoolInfo, user?.shopName, i18n.language)}>
                <Download className="h-4 w-4 mr-2" />
                {t("receipts.download")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Receipts;
