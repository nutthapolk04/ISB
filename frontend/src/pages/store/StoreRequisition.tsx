import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { Plus, Minus, Trash2, ShoppingCart, HandHelping, ScanBarcode } from "lucide-react";
import UserPicker from "@/components/UserPicker";
import type { DepartmentOption } from "./DepartmentPaymentModal";
import { useStoreRfidScanner } from "@/hooks/useStoreRfidScanner";
import { cn } from "@/lib/utils";
import type { Product as StoreProduct } from "@/pages/store/storeTypes";

interface Product {
  id: number;
  productCode: string;
  barcode: string;
  name: string;
  stock: number;
  category: string;
  shopId: string;
  internalPrice: number;
  externalPrice: number;
  photoUrl: string | null;
  color: string | null;
}

interface CartItem extends Product {
  qty: number;
}

interface Shop {
  id: string;
  name: string;
  allow_department_charge: boolean;
}

type PayMode = "free" | "department" | "wallet";

export default function StoreRequisition() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [shops, setShops] = useState<Shop[]>([]);
  const [activeShopId, setActiveShopId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [requesterId, setRequesterId] = useState<number | null>(null);
  // Defaults to "department" — most requisitions are charged to a
  // department, so this saves the extra pick on every checkout. Shops that
  // don't allow department charge already disable that option below, so the
  // cashier just picks something else in that case.
  const [payMode, setPayMode] = useState<PayMode>("department");
  const [deptId, setDeptId] = useState<number | null>(null);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.get<Shop[]>("/shops/?active_only=true");
        if (cancelled) return;
        setShops(list);
        const initial = user?.shopId ?? list[0]?.id ?? null;
        setActiveShopId(initial);
      } catch (err) {
        toast.error(err instanceof ApiError ? err.detail : "Failed to load shops");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.shopId]);

  useEffect(() => {
    if (!activeShopId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<any[]>(`/shops/${activeShopId}/products`);
        if (cancelled) return;
        setProducts(
          data.map((p) => ({
            id: p.id,
            productCode: p.product_code,
            barcode: p.barcode ?? "",
            name: p.name,
            stock: p.stock,
            category: p.category,
            shopId: p.shop_id,
            internalPrice: Number(p.internal_price ?? 0),
            externalPrice: Number(p.external_price ?? 0),
            photoUrl: p.photo_url ?? null,
            color: p.color ?? null,
          })),
        );
      } catch (err) {
        toast.error(err instanceof ApiError ? err.detail : "Failed to load products");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeShopId]);

  useEffect(() => {
    if (!checkoutOpen) return;
    api
      .get<DepartmentOption[]>("/departments/")
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, [checkoutOpen]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.productCode.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q),
    );
  }, [products, search]);

  const activeShop = shops.find((s) => s.id === activeShopId) ?? null;

  const addToCart = (p: Product) => {
    setCart((prev) => {
      const existing = prev.find((x) => x.id === p.id);
      if (existing) return prev.map((x) => (x.id === p.id ? { ...x, qty: x.qty + 1 } : x));
      return [...prev, { ...p, qty: 1 }];
    });
  };

  // Passive barcode/RFID scan — same behavior as the Store POS page. There's
  // no "member" concept in requisition, so member lookups are a no-op. The
  // hook's Product type (price/subMerchantId) differs from this page's own
  // (externalPrice/internalPrice/shopId) — cast at this one boundary rather
  // than reshaping either type.
  const rfidScanner = useStoreRfidScanner({
    products: products as unknown as StoreProduct[],
    onProductMatch: (p) => addToCart(p as unknown as Product),
    onMemberFound: () => {},
  });

  // Manager/admin can push a line negative — meaning stock is being
  // returned/added back rather than issued out. Cashiers keep the original
  // "can't go below 1, remove instead" behavior. Negative is only reachable
  // by decrementing past zero, so for manager/admin the auto-remove-at-zero
  // cleanup is skipped entirely (they use the trash button instead).
  const canGoNegative = user?.role === "manager" || user?.role === "admin";

  const updateQty = (id: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((x) => (x.id === id ? { ...x, qty: x.qty + delta } : x))
        .filter((x) => (canGoNegative ? true : x.qty > 0)),
    );
  };

  const removeItem = (id: number) => setCart((prev) => prev.filter((x) => x.id !== id));

  const cartTotal = useMemo(
    () => cart.reduce((sum, x) => sum + (x.internalPrice || x.externalPrice) * x.qty, 0),
    [cart],
  );

  const openCheckout = () => {
    if (cart.length === 0) {
      toast.error(t("requisition.errorEmptyCart", "Cart is empty"));
      return;
    }
    setRequesterId(null);
    setPayMode("department");
    setDeptId(null);
    setNotes("");
    setCheckoutOpen(true);
  };

  const submit = async () => {
    if (!activeShopId) return;
    if (!requesterId) {
      toast.error(t("requisition.errorRequester", "Please select a requester"));
      return;
    }
    if (payMode === "department" && !deptId) {
      toast.error(t("requisition.errorDept", "Please select a department"));
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/shops/${activeShopId}/requisition`, {
        items: cart.map((x) => ({ product_id: x.id, qty: x.qty })),
        requester_user_id: requesterId,
        pay_mode: payMode,
        payer_department_id: payMode === "department" ? deptId : undefined,
        notes: notes.trim() || undefined,
      });
      toast.success(t("requisition.success", "Requisition recorded"));
      setCart([]);
      setCheckoutOpen(false);
    } catch (err: any) {
      toast.error(err instanceof ApiError ? err.detail : err?.message || "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 p-4 sm:p-6 h-full">
      {/* Product list */}
      <div className="flex-1 space-y-4 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
              <HandHelping className="h-6 w-6" />
              {t("requisition.pageTitle", "Staff Requisition")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("requisition.pageDescription", "Issue stock to internal staff with optional department/wallet charge.")}
            </p>
          </div>
          {shops.length > 1 && !user?.shopId && (
            <Select value={activeShopId ?? ""} onValueChange={setActiveShopId}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue placeholder={t("requisition.selectShop", "Select shop")} />
              </SelectTrigger>
              <SelectContent>
                {shops.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="relative">
          <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("requisition.searchPlaceholder", "Search or scan a barcode")}
            className="pl-9"
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filteredProducts.map((p) => (
            <button
              key={p.id}
              onClick={() => addToCart(p)}
              className="group flex flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left transition hover:border-primary hover:shadow"
              style={p.color ? { borderColor: p.color } : undefined}
            >
              <span className="font-medium truncate w-full">{p.name}</span>
              <span className="text-xs text-muted-foreground">
                {p.category} · {t("requisition.stockShort", "stock")}: {p.stock}
              </span>
            </button>
          ))}
          {filteredProducts.length === 0 && (
            <div className="col-span-full p-8 text-center text-muted-foreground">
              {t("requisition.noProducts", "No products found")}
            </div>
          )}
        </div>
      </div>

      {/* Cart */}
      <Card className="lg:w-96 shrink-0 self-start">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            {t("requisition.cart", "Requisition Cart")}
            {cart.length > 0 && <Badge variant="secondary">{cart.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {cart.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("requisition.cartEmpty", "Tap a product to add")}
            </p>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-md border p-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(item.internalPrice || item.externalPrice).toFixed(2)} ฿ × {item.qty}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(item.id, -1)}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-6 text-center text-sm">{item.qty}</span>
                  <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(item.id, 1)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={() => removeItem(item.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
          {cart.length > 0 && (
            <>
              <div className="flex items-center justify-between border-t pt-3 text-sm">
                <span className="text-muted-foreground">{t("requisition.referenceTotal", "Reference total")}</span>
                <span className="font-semibold">฿{cartTotal.toFixed(2)}</span>
              </div>
              <Button
                variant="outline"
                className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                onClick={() => setCart([])}
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                {t("requisition.clearCart", "Clear all")}
              </Button>
              <Button className="w-full" onClick={openCheckout} disabled={cart.length === 0}>
                {t("requisition.proceed", "Issue / Checkout")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Checkout Dialog */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("requisition.checkoutTitle", "Confirm Requisition")}</DialogTitle>
            <DialogDescription>
              {cart.length} {t("requisition.itemsCount", "item(s)")} ·{" "}
              {t("requisition.referenceTotal", "Reference total")}: ฿{cartTotal.toFixed(2)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("requisition.requester", "Requester")} *</Label>
              <UserPicker value={requesterId} onChange={(id) => setRequesterId(id)} />
            </div>
            <div>
              <Label>{t("requisition.payMode", "Payment mode")} *</Label>
              <Select value={payMode} onValueChange={(v) => setPayMode(v as PayMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">{t("requisition.payFree", "Free (stock-only audit)")}</SelectItem>
                  <SelectItem value="department" disabled={activeShop?.allow_department_charge === false}>
                    {t("requisition.payDept", "Charge department")}
                  </SelectItem>
                  <SelectItem value="wallet">{t("requisition.payWallet", "Charge requester wallet")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {payMode === "department" && (
              <div>
                <Label>{t("requisition.dept", "Department")} *</Label>
                <Select value={deptId ? String(deptId) : ""} onValueChange={(v) => setDeptId(parseInt(v, 10))}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("requisition.selectDept", "Select department")} />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.department_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>{t("requisition.notes", "Notes")}</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckoutOpen(false)} disabled={submitting}>
              {t("requisition.cancel", "Cancel")}
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? t("requisition.submitting", "Submitting…") : t("requisition.confirm", "Confirm Issue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RFID/barcode scan auto-dismiss notification — same styling as Store POS */}
      {rfidScanner.notif && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div
            key={rfidScanner.notif.key}
            className={cn(
              "relative rounded-2xl px-8 py-6 shadow-2xl text-center min-w-[260px] max-w-[340px]",
              "animate-in fade-in zoom-in-95 duration-150 pointer-events-auto",
              rfidScanner.notif.type === "success"
                ? "bg-amber-50 border-2 border-amber-300"
                : "bg-red-50 border-2 border-red-300",
            )}
          >
            <button
              onClick={rfidScanner.dismissNotif}
              className={cn(
                "absolute top-2 right-2 rounded-full p-1 hover:bg-black/10 transition-colors",
                rfidScanner.notif.type === "success" ? "text-amber-500" : "text-red-400",
              )}
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            {rfidScanner.notif.type === "success" ? (
              <>
                <div className="flex justify-center mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <div className="text-xl font-bold text-amber-900 leading-tight">{rfidScanner.notif.title}</div>
                {rfidScanner.notif.sub && (
                  <div className="text-2xl font-extrabold text-amber-600 mt-1 tabular-nums">{rfidScanner.notif.sub}</div>
                )}
              </>
            ) : (
              <>
                <div className="flex justify-center mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                </div>
                <div className="text-base font-semibold text-red-700">{rfidScanner.notif.title}</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
