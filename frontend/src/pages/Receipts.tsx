import { useState, useEffect, useCallback, useMemo } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { IconButton } from "@/components/IconButton";
import { InfoCallout } from "@/components/InfoCallout";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

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

interface ReceiptApi {
  id: number;
  receipt_number: string;
  transaction_date: string;
  transaction_mode: string;
  customer_id: number | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payment_method: string;
  status: string;
  notes: string | null;
  created_at: string;
  created_by: number;
  voided_at: string | null;
  voided_by: number | null;
  voided_reason: string | null;
  items: ReceiptItemApi[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PAYMENT_LABELS: Record<string, string> = {
  cash: "เงินสด",
  credit_card: "บัตรเครดิต",
  debit_card: "บัตรเดบิต",
  wallet: "Wallet",
  bank_transfer: "โอนเงิน",
  qr: "QR PromptPay",
  qr_promptpay: "QR PromptPay",
  edc: "EDC (บัตรเครดิต/เดบิต)",
  other: "อื่นๆ",
};

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
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

// ── Component ────────────────────────────────────────────────────────────────

const Receipts = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { pathname } = useLocation();

  // ── Module scope detection (from URL) ───────────────────────────────────
  const moduleScope: ModuleScope = pathname.startsWith("/canteen")
    ? "canteen"
    : "store";

  const [receipts, setReceipts] = useState<ReceiptApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptApi | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // ── Void / cancel ───────────────────────────────────────────────────────
  const [voidTarget, setVoidTarget] = useState<ReceiptApi | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidLoading, setVoidLoading] = useState(false);

  const canVoid = user?.role === "admin" || user?.role === "manager";

  const handleVoidConfirm = async () => {
    if (!voidTarget) return;
    setVoidLoading(true);
    try {
      const updated = await api.post<ReceiptApi>(`/pos/void/${voidTarget.id}`, {
        reason: voidReason.trim() || null,
      });
      setReceipts((prev) => prev.map((r) => r.id === updated.id ? updated : r));
      toast.success(`ยกเลิก ${voidTarget.receipt_number} สำเร็จ — เงินคืนเข้ากระเป๋าแล้ว`);
      setVoidTarget(null);
      setVoidReason("");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "ยกเลิกใบเสร็จไม่สำเร็จ");
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
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      r.receipt_number.toLowerCase().includes(q) ||
      r.payment_method.toLowerCase().includes(q) ||
      r.status.toLowerCase().includes(q) ||
      fmtDate(r.transaction_date).includes(q)
    );
  });

  const totalSales = receipts
    .filter((r) => r.status === "active")
    .reduce((s, r) => s + r.total, 0);

  const todayStr = new Date().toISOString().slice(0, 10);
  const todaySales = receipts
    .filter((r) => r.status === "active" && fmtDateOnly(r.transaction_date) === todayStr)
    .reduce((s, r) => s + r.total, 0);

  const handleViewReceipt = (receipt: ReceiptApi) => {
    setSelectedReceipt(receipt);
    setIsDialogOpen(true);
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

      {/* Receipts List */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center">
              <Receipt className="h-6 w-6 mr-2 text-primary" />
              <CardTitle>{t("receipts.allReceipts")}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("receipts.searchReceipt")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full sm:max-w-xs"
              />
            </div>
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
                  <TableHead>{t("receipts.items")}</TableHead>
                  <TableHead className="text-right">{t("receipts.total")}</TableHead>
                  <TableHead>{t("receipts.paymentMethod")}</TableHead>
                  <TableHead className="text-center">{t("receipts.status")}</TableHead>
                  <TableHead className="text-center">{t("receipts.manage")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReceipts.map((receipt) => (
                  <TableRow key={receipt.id}>
                    <TableCell className="font-mono text-sm">{receipt.receipt_number}</TableCell>
                    <TableCell>{fmtDate(receipt.transaction_date)}</TableCell>
                    <TableCell>
                      {t("receipts.itemsCount", { count: receipt.items.length })}
                    </TableCell>
                    <TableCell className="text-right font-semibold data-number">
                      ฿{receipt.total.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {PAYMENT_LABELS[receipt.payment_method] ?? receipt.payment_method}
                      </Badge>
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
                        <IconButton tooltip={t("receipts.tooltip.download")}>
                          <Download className="h-4 w-4" />
                        </IconButton>
                        {canVoid && receipt.status === "active" && (
                          <IconButton
                            tooltip="ยกเลิก / Void"
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
        </CardContent>
      </Card>

      {/* ── Void Confirmation Dialog ─────────────────────────────────────── */}
      <Dialog open={!!voidTarget} onOpenChange={(v) => { if (!v && !voidLoading) setVoidTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Ban className="h-5 w-5" />
              ยกเลิกใบเสร็จ
            </DialogTitle>
            <DialogDescription>
              {voidTarget?.receipt_number} · ฿{voidTarget?.total.toLocaleString()}
              {" "}— หากชำระด้วย Wallet เงินจะคืนเข้ากระเป๋าอัตโนมัติ
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium">เหตุผลการยกเลิก (ไม่บังคับ)</label>
              {/* Preset reason chips */}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[
                  "ทำรายการผิด",
                  "ลูกค้าเปลี่ยนใจ",
                  "สินค้าหมด",
                  "ราคาไม่ถูกต้อง",
                  "ชำระเงินซ้ำ",
                  "ทดสอบระบบ",
                ].map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={voidLoading}
                    onClick={() => setVoidReason(r)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition",
                      voidReason === r
                        ? "border-destructive bg-destructive/10 text-destructive font-semibold"
                        : "border-border bg-muted/50 text-muted-foreground hover:border-destructive/50 hover:text-foreground",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <Textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="หรือพิมพ์เหตุผลเอง…"
                rows={2}
                className="mt-2 resize-none"
                disabled={voidLoading}
              />
            </div>
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
              ⚠ การยกเลิกไม่สามารถย้อนกลับได้
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setVoidTarget(null)}
              disabled={voidLoading}
            >
              ยกเลิก
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleVoidConfirm}
              disabled={voidLoading}
            >
              {voidLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              ยืนยัน Void
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
                    {PAYMENT_LABELS[selectedReceipt.payment_method] ?? selectedReceipt.payment_method}
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
              <div className="space-y-2">
                <h4 className="font-semibold">{t("receipts.productList")}</h4>
                {selectedReceipt.items.map((item) => {
                  const gross = item.line_total;
                  const hasItemDiscount = item.discount > 0;
                  return (
                    <div key={item.id} className="text-sm">
                      <div className="flex justify-between">
                        <span>
                          {item.product_variant?.variant_name ?? `Product #${item.product_variant_id}`} x {item.quantity}
                        </span>
                        <span className="data-number">฿{gross.toLocaleString()}</span>
                      </div>
                      {item.options && item.options.groups.length > 0 && (
                        <div className="pl-4 pt-0.5 space-y-0.5 text-xs text-muted-foreground">
                          {item.options.groups.flatMap((g) =>
                            g.options.map((o) => (
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
              <Button className="w-full" variant="outline">
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
