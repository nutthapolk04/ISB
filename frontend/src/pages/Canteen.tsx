import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InfoCallout } from "@/components/InfoCallout";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CreditCard, Search, ShoppingCart, UtensilsCrossed, UserSearch, Wallet, ArrowUpDown, Check as CheckIcon } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { printReceipt, type ReceiptApi } from "@/lib/printReceipt";
import { useCanteenCart, type CanteenProduct } from "@/hooks/useCanteenCart";
import type { SelectedOptionGroup } from "./canteen/menuOptionTypes";
import { CategoryTabs } from "./canteen/CategoryTabs";
import { ProductGrid } from "./canteen/ProductGrid";
import { CanteenCart } from "./canteen/CanteenCart";
import { DiscountModal } from "./canteen/DiscountModal";
import MenuOptionModal from "./canteen/MenuOptionModal";
import {
  PaymentMethodPicker,
  type CanteenPaymentMethod,
} from "./canteen/PaymentMethodPicker";
import {
  RfidPaymentModal,
  type StudentLookupResult,
  type UserPayerLookup,
  type WalletPayer,
} from "./canteen/RfidPaymentModal";
import { CashPaymentModal } from "./canteen/CashPaymentModal";
import { QrPaymentModal } from "./canteen/QrPaymentModal";
import { ReceiptSuccessModal } from "./canteen/ReceiptSuccessModal";
import { DepartmentPaymentModal, type DepartmentOption } from "./store/DepartmentPaymentModal";
import { MemberSearchModal } from "./canteen/MemberSearchModal";
import { CardTapModal } from "./canteen/CardTapModal";
import { CashierTopupModal } from "@/components/CashierTopupModal";

/** Fallback when user has no shopId (e.g., admin browsing canteen) */
const DEFAULT_CANTEEN_SHOP_ID = "canteen";

interface ShopProductApiShape {
  id: number;
  product_code: string;
  name: string;
  category: string;
  external_price: number;
  internal_price: number;
  stock: number;
  has_options?: boolean;
  color?: string | null;
}


interface CheckoutResponse {
  receipt_number: string;
  total: number;
}

export default function Canteen() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const schoolInfo = useSchoolInfo();
  // Cashier/manager → their shop; admin viewer → fallback to "canteen"
  const CANTEEN_SHOP_ID = user?.shopId ?? DEFAULT_CANTEEN_SHOP_ID;
  const cart = useCanteenCart();
  const [products, setProducts] = useState<CanteenProduct[]>([]);

  // ── Product color editing (palette popover on tile) ─────────────────────
  const [colorEditId, setColorEditId] = useState<number | null>(null);
  const [colorSaving, setColorSaving] = useState(false);

  // ── Product reorder (drag-and-drop on POS grid) ─────────────────────────
  const [reorderMode, setReorderMode] = useState(false);
  const [reorderDirty, setReorderDirty] = useState(false);
  const [reorderSaving, setReorderSaving] = useState(false);
  const [productsOrderVersion, setProductsOrderVersion] = useState<number | null>(null);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setProducts((prev) => {
      const oldIdx = prev.findIndex((p) => String(p.id) === String(active.id));
      const newIdx = prev.findIndex((p) => String(p.id) === String(over.id));
      if (oldIdx === -1 || newIdx === -1) return prev;
      setReorderDirty(true);
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  const saveReorder = async () => {
    setReorderSaving(true);
    try {
      const sortMap: Record<string, number> = {};
      products.forEach((p, idx) => { sortMap[String(p.id)] = idx + 1; });
      const version = productsOrderVersion ?? 1;
      const res = await api.post<{ version: number; updated: number }>(
        `/shops/${CANTEEN_SHOP_ID}/products/reorder`,
        { version, sort_map: sortMap },
      );
      setProductsOrderVersion(res.version);
      setReorderDirty(false);
      setReorderMode(false);
      toast.success("จัดลำดับแล้ว");
    } catch (e: any) {
      if (e?.status === 409 || e?.detail?.current_version) {
        toast.error("คนอื่นเปลี่ยนลำดับก่อนแล้ว — กรุณารีเฟรชแล้วลองใหม่");
        const newVer = e?.detail?.current_version;
        if (newVer) setProductsOrderVersion(newVer);
      } else {
        toast.error(e instanceof ApiError ? e.detail : "บันทึกลำดับไม่สำเร็จ");
      }
    } finally {
      setReorderSaving(false);
    }
  };

  const saveProductColor = async (product: CanteenProduct, color: string | null) => {
    setColorSaving(true);
    try {
      await api.patch(`/shops/${CANTEEN_SHOP_ID}/products/${product.id}`, { color });
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, color } : p)),
      );
      toast.success(t("store.colorSaved", "Color updated"));
      setColorEditId(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "Failed to save color");
    } finally {
      setColorSaving(false);
    }
  };
  const [productsLoading, setProductsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  // Per-shop pricing model — single-pricing canteens hide the Retail/Internal
  // toggle entirely. Defaults to dual until the shop meta loads.
  const [usesDualPricing, setUsesDualPricing] = useState(true);

  const [discountOpen, setDiscountOpen] = useState(false);
  const [methodPickerOpen, setMethodPickerOpen] = useState(false);
  const [rfidOpen, setRfidOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [memberSearchOpen, setMemberSearchOpen] = useState(false);
  const [cardTapOpen, setCardTapOpen] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [walletLimitError, setWalletLimitError] = useState<string | null>(null);
  // Pre-selected member from search (for "ready to pay" flow)
  const [preSelectedMember, setPreSelectedMember] = useState<StudentLookupResult | null>(null);

  // ── Departments (for department payment option) ──────────────────────────
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [shopAllowsDept, setShopAllowsDept] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<DepartmentOption[]>("/departments/");
        if (!cancelled) setDepartmentOptions(data);
      } catch { /* tolerate */ }
      try {
        const meta = await api.get<{ allow_department_charge?: boolean; products_order_version?: number }>(`/shops/${CANTEEN_SHOP_ID}`);
        if (!cancelled) {
          setShopAllowsDept(meta.allow_department_charge ?? false);
          if (meta.products_order_version != null) setProductsOrderVersion(meta.products_order_version);
        }
      } catch { /* tolerate */ }
    })();
    return () => { cancelled = true; };
  }, [CANTEEN_SHOP_ID]);

  const [successOpen, setSuccessOpen] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<{
    number: string;
    amount: number;
    remainingBalance: number | null;
    studentName?: string | null;
    studentPhotoUrl?: string | null;
    studentGrade?: string | null;
  } | null>(null);

  // Product being customised in the MenuOptionModal.
  const [optionTarget, setOptionTarget] = useState<CanteenProduct | null>(null);

  // Special item (price=0) — cashier must enter price before adding.
  const [specialItemTarget, setSpecialItemTarget] = useState<CanteenProduct | null>(null);
  const [specialItemPrice, setSpecialItemPrice] = useState("");
  const specialItemInputRef = useRef<HTMLInputElement>(null);

  // Mobile cart sheet (shown below lg breakpoint).
  const [cartOpen, setCartOpen] = useState(false);

  // ── RFID centered notification ────────────────────────────────────────────
  const [rfidNotif, setRfidNotif] = useState<{
    key: number;
    type: "success" | "error";
    title: string;
    sub?: string;
  } | null>(null);
  const rfidNotifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rfidNotifKey = useRef(0);

  // ── Passive RFID listener (capture phase) ────────────────────────────────
  // RFID readers emit keypresses as fast keyboard input, ending with Enter.
  // Uses capture phase (true) so we intercept BEFORE focused inputs receive chars.
  // Strategy:
  //   - Buffer chars arriving < 50 ms apart (RFID speed)
  //   - On 2nd+ fast char: enter rfidMode → preventDefault to stop chars going into inputs
  //   - On Enter in rfidMode: lookup and clear search box (first char may have slipped in)
  //   - Gap > 100 ms resets buffer (human typing)
  const rfidBuffer = useRef<string>("");
  const rfidLastKey = useRef<number>(0);
  const rfidMode = useRef<boolean>(false);

  useEffect(() => {
    function userToStudent(u: UserPayerLookup): StudentLookupResult {
      return {
        id: u.user_id,
        name: u.full_name,
        photo_url: u.photo_url ?? null,
        customer_code: u.username,
        wallet_balance: u.wallet_balance,
        wallet_id: u.wallet_id,
        customer_kind: u.role,
        user_id: u.user_id,
      };
    }

    function showRfidNotif(notif: { type: "success" | "error"; title: string; sub?: string }) {
      if (rfidNotifTimer.current) clearTimeout(rfidNotifTimer.current);
      rfidNotifKey.current += 1;
      setRfidNotif({ ...notif, key: rfidNotifKey.current });
      rfidNotifTimer.current = setTimeout(() => setRfidNotif(null), 2500);
    }

    async function lookupAndSet(q: string) {
      const trimmed = q.trim();
      if (!trimmed || trimmed.length < 3) return;
      try {
        let result: StudentLookupResult | null = null;
        try {
          result = await api.get<StudentLookupResult>(`/customers/by-card/${encodeURIComponent(trimmed)}`);
        } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
        if (!result) {
          try {
            const u = await api.get<UserPayerLookup>(`/users/by-card/${encodeURIComponent(trimmed)}`);
            result = userToStudent(u);
          } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
        }
        if (!result) {
          try {
            result = await api.get<StudentLookupResult>(`/customers/by-code/${encodeURIComponent(trimmed)}`);
          } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
        }
        if (!result) {
          try {
            const u = await api.get<UserPayerLookup>(`/users/by-username/${encodeURIComponent(trimmed)}`);
            result = userToStudent(u);
          } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
        }
        if (result) {
          setPreSelectedMember(result);
          setSearch("");
          const bal = result.wallet_balance != null
            ? `฿${Number(result.wallet_balance).toFixed(2)}`
            : undefined;
          showRfidNotif({ type: "success", title: result.name, sub: bal });
        } else {
          showRfidNotif({ type: "error", title: "Card not found" });
        }
      } catch {
        showRfidNotif({ type: "error", title: "Card not found" });
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      const now = Date.now();
      const gap = now - rfidLastKey.current;

      if (e.key === "Enter") {
        if (rfidMode.current && rfidBuffer.current.length >= 3) {
          e.preventDefault();
          e.stopPropagation();
          const captured = rfidBuffer.current;
          rfidBuffer.current = "";
          rfidMode.current = false;
          rfidLastKey.current = 0;
          void lookupAndSet(captured);
        } else {
          // Not RFID — reset
          rfidBuffer.current = "";
          rfidMode.current = false;
        }
        return;
      }

      if (e.key.length !== 1) return;

      // Reset if gap too large (human typing pace)
      if (gap > 100 && rfidBuffer.current.length > 0) {
        rfidBuffer.current = "";
        rfidMode.current = false;
      }

      rfidLastKey.current = now;
      rfidBuffer.current += e.key;

      // 2nd+ char within 50 ms → RFID reader speed detected
      if (gap < 50 && rfidBuffer.current.length >= 2) {
        rfidMode.current = true;
      }

      // In RFID mode: prevent char from reaching any focused input
      if (rfidMode.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    // capture: true — fires before focused element receives the event
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  const handleProductTap = (product: CanteenProduct) => {
    if (product.price === 0) {
      setSpecialItemTarget(product);
      setSpecialItemPrice("");
      return;
    }
    if (product.hasOptions) {
      setOptionTarget(product);
    } else {
      cart.addItem(product);
    }
  };

  const handleOptionsConfirmed = (groups: SelectedOptionGroup[]) => {
    if (!optionTarget) return;
    cart.addItemWithOptions(optionTarget, groups);
    setOptionTarget(null);
  };

  // ── Load canteen products ──────────────────────────────────────────────
  const loadProducts = async () => {
    setProductsLoading(true);
    try {
      const data = await api.get<ShopProductApiShape[]>(
        `/shops/${CANTEEN_SHOP_ID}/products`,
      );
      setProducts(
        data.map((p) => ({
          id: p.id,
          productCode: p.product_code,
          name: p.name,
          price: Number(p.external_price),
          internalPrice: Number(p.internal_price),
          category: p.category,
          stock: p.stock,
          hasOptions: Boolean(p.has_options),
          color: p.color ?? null,
        })),
      );
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.detail
          : "Could not load canteen products",
      );
    } finally {
      setProductsLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [CANTEEN_SHOP_ID]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ uses_dual_pricing?: boolean }>(`/shops/${CANTEEN_SHOP_ID}`)
      .then((meta) => {
        if (!cancelled) setUsesDualPricing(meta.uses_dual_pricing ?? true);
      })
      .catch(() => {
        // Fail-open: keep default true so existing behaviour is preserved.
      });
    return () => {
      cancelled = true;
    };
  }, [CANTEEN_SHOP_ID]);

  // Single-pricing shops never enter "internal" mode — pin to retail.
  useEffect(() => {
    if (!usesDualPricing && cart.priceMode !== "retail") {
      cart.setPriceMode("retail");
    }
  }, [usesDualPricing, cart]);

  // ── Filtering ──────────────────────────────────────────────────────────
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of products) {
      counts[p.category] = (counts[p.category] ?? 0) + 1;
    }
    return counts;
  }, [products]);

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCategory !== "All" && p.category !== activeCategory)
        return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.productCode.toLowerCase().includes(q)
      );
    });
  }, [products, search, activeCategory]);

  // ── Checkout ───────────────────────────────────────────────────────────
  const doCheckout = async (
    backendPaymentMethod: "wallet" | "cash" | "other" | "edc" | "department",
    payer?:
      | { kind: "customer"; customerId: number }
      | { kind: "user"; userId: number }
      | { kind: "department"; departmentId: number },
  ) => {
    setConfirming(true);
    try {
      const payload = {
        transaction_mode:
          cart.priceMode === "internal" ? "internal_issue" : "sale",
        payment_method: backendPaymentMethod,
        payer_kind: payer?.kind ?? "customer",
        customer_id: payer?.kind === "customer" ? payer.customerId : undefined,
        payer_user_id: payer?.kind === "user" ? payer.userId : undefined,
        payer_department_id: payer?.kind === "department" ? payer.departmentId : undefined,
        shop_id: CANTEEN_SHOP_ID,
        items: cart.items.map((i) => ({
          product_variant_id: i.id,
          quantity: i.quantity,
          unit_price:
            cart.priceMode === "internal" ? i.internalPrice : i.price,
          // Cashier-entered one-time override (null when untouched). Backend
          // bills the line at this value; unit_price stays as the catalog price.
          price_override: i.priceOverride ?? null,
          discount: cart.lineDiscountAmountFor(i),
          options: i.selectedOptions.flatMap((g) =>
            g.options.map((o) => ({
              option_id: o.id,
              quantity: o.quantity,
            })),
          ),
        })),
        discount: cart.billDiscountAmount,
      };
      const res = await api.post<CheckoutResponse>("/pos/checkout", payload);
      return res;
    } finally {
      setConfirming(false);
    }
  };

  const finalizeSuccess = (
    receiptNumber: string,
    amount: number,
    remainingBalance: number | null,
    student?: StudentLookupResult | null,
    fullReceipt?: ReceiptApi,
  ) => {
    setLastReceipt({
      number: receiptNumber,
      amount,
      remainingBalance,
      studentName: student?.name ?? null,
      studentPhotoUrl: student?.photo_url ?? null,
      studentGrade: student?.grade ?? null,
    });
    // Auto-print receipt — fires once per completed sale. Silent printing
    // requires Chromium launched with --kiosk-printing on the cashier station.
    if (fullReceipt) {
      try {
        printReceipt(fullReceipt, schoolInfo, user?.shopName, i18n.language);
      } catch (printErr) {
        console.warn("Auto-print failed:", printErr);
      }
    }
    setSuccessOpen(true);
    // Optimistic stock update
    setProducts((prev) =>
      prev.map((p) => {
        const cartItem = cart.items.find((c) => c.id === p.id);
        return cartItem
          ? { ...p, stock: p.stock - cartItem.quantity }
          : p;
      }),
    );
    cart.clearCart();
    // Close payment modals
    setRfidOpen(false);
    setCashOpen(false);
    setQrOpen(false);
    setDeptOpen(false);
    setMethodPickerOpen(false);
    setCartOpen(false);
  };

  const handleSelectMethod = (method: CanteenPaymentMethod) => {
    setMethodPickerOpen(false);
    if (method === "wallet") setRfidOpen(true);
    else if (method === "cash") setCashOpen(true);
    else if (method === "edc") void handleConfirmEdc();
    else if (method === "department") setDeptOpen(true);
    else setQrOpen(true);
  };

  const handleConfirmDept = async (deptId: number, _empCode: string | null) => {
    try {
      const amount = cart.total;
      const res = await doCheckout("department", { kind: "department", departmentId: deptId });
      finalizeSuccess(res.receipt_number, amount, null, null, res as unknown as ReceiptApi);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "Checkout failed");
    }
  };

  const handleConfirmWallet = async (payer: WalletPayer) => {
    try {
      const amount = cart.total;
      if (payer.kind === "department") {
        const res = await doCheckout("department", {
          kind: "department",
          departmentId: payer.department.id,
        });
        finalizeSuccess(res.receipt_number, amount, null, null, res as unknown as ReceiptApi);
        return;
      }
      if (payer.kind === "customer") {
        const student = payer.student;
        const currentBalance = Number(student.wallet_balance ?? 0);
        const res = await doCheckout("wallet", {
          kind: "customer",
          customerId: student.id,
        });
        finalizeSuccess(
          res.receipt_number,
          amount,
          currentBalance - amount,
          student,
          res as unknown as ReceiptApi,
        );
        return;
      }
      // payer.kind === "user"
      const u = payer.user;
      const currentBalance = Number(u.wallet_balance ?? 0);
      const res = await doCheckout("wallet", {
        kind: "user",
        userId: u.user_id,
      });
      finalizeSuccess(res.receipt_number, amount, currentBalance - amount, {
        // Reuse the receipt-success modal slot for the payer name + photo so
        // cashier sees confirmation of who was charged.
        id: u.user_id,
        name: u.full_name,
        customer_code: u.username,
        student_code: u.username,
        grade: u.role,
        photo_url: u.photo_url ?? null,
        wallet_balance: u.wallet_balance,
      } as StudentLookupResult, res as unknown as ReceiptApi);
    } catch (e) {
      if (e instanceof ApiError && e.code?.startsWith("EXCEEDS_NEGATIVE_CREDIT_LIMIT")) {
        setWalletLimitError(e.detail);
      } else {
        toast.error(e instanceof ApiError ? e.detail : "Checkout failed");
      }
    }
  };

  const handleConfirmCash = async () => {
    try {
      const amount = cart.total;
      const res = await doCheckout("cash");
      finalizeSuccess(res.receipt_number, amount, null, null, res as unknown as ReceiptApi);
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.detail : "Checkout failed",
      );
    }
  };

  const handleConfirmQr = async () => {
    try {
      const amount = cart.total;
      const res = await doCheckout("other");
      finalizeSuccess(res.receipt_number, amount, null, null, res as unknown as ReceiptApi);
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.detail : "Checkout failed",
      );
    }
  };

  const handleConfirmEdc = async () => {
    try {
      const amount = cart.total;
      const res = await doCheckout("edc");
      finalizeSuccess(res.receipt_number, amount, null, null, res as unknown as ReceiptApi);
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.detail : "Checkout failed",
      );
    }
  };

  // Handle charge button - if member is pre-selected, charge directly
  const handleCharge = async () => {
    if (preSelectedMember) {
      // Direct charge for pre-selected member (wallet or department)
      setConfirming(true);
      try {
        const amount = cart.total;
        const currentBalance = Number(preSelectedMember.wallet_balance ?? 0);
        // Department payer — use dept checkout path
        if (preSelectedMember.customer_kind === "department") {
          const res = await doCheckout("department", {
            kind: "department",
            departmentId: preSelectedMember.id,
          });
          finalizeSuccess(res.receipt_number, amount, null, null, res as unknown as ReceiptApi);
          setPreSelectedMember(null);
          return;
        }
        const res = await doCheckout(
          "wallet",
          preSelectedMember.user_id != null
            ? { kind: "user", userId: preSelectedMember.user_id }
            : { kind: "customer", customerId: preSelectedMember.id },
        );
        finalizeSuccess(
          res.receipt_number,
          amount,
          currentBalance - amount,
          preSelectedMember,
          res as unknown as ReceiptApi,
        );
        setPreSelectedMember(null);
      } catch (e) {
        if (e instanceof ApiError && e.code?.startsWith("EXCEEDS_NEGATIVE_CREDIT_LIMIT")) {
          setWalletLimitError(e.detail);
        } else {
          toast.error(e instanceof ApiError ? e.detail : "Checkout failed");
        }
      } finally {
        setConfirming(false);
      }
    } else {
      // No member selected - show payment method picker
      setMethodPickerOpen(true);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="canteen-layout">
      {/* Main — catalog */}
      <div className="canteen-content">
        {/* Header */}
        <div className="page-header flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <UtensilsCrossed className="h-7 w-7 text-amber-500" />
              Canteen POS
            </h1>
            <p className="page-description">
              Tap a dish to add it to the order — then charge via wallet, cash
              or QR.
            </p>
          </div>
          <InfoCallout
            id="canteen.retailVsInternal"
            variant="tip"
            title="Retail vs Internal"
            className="mt-2 max-w-xl"
          >
            {t("canteen.pos.retailVsInternalDesc")}
          </InfoCallout>
          <div className="flex items-center gap-3">
            {usesDualPricing && (
              <div
                className="flex items-center gap-1 rounded-full bg-muted p-1"
                role="group"
                aria-label="Price mode"
              >
                <button
                  type="button"
                  onClick={() => cart.setPriceMode("retail")}
                  className={cn(
                    "px-3 py-1 text-xs font-semibold rounded-full transition",
                    cart.priceMode === "retail"
                      ? "bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Retail
                </button>
                <button
                  type="button"
                  onClick={() => cart.setPriceMode("internal")}
                  className={cn(
                    "px-3 py-1 text-xs font-semibold rounded-full transition",
                    cart.priceMode === "internal"
                      ? "bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Internal
                </button>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTopupOpen(true)}
              className="gap-1.5"
            >
              <Wallet className="h-4 w-4" />
              <span className="hidden sm:inline">{t("canteen.pos.topUp")}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMemberSearchOpen(true)}
              className="gap-1.5"
            >
              <UserSearch className="h-4 w-4" />
              <span className="hidden sm:inline">{t("canteen.pos.searchMember")}</span>
            </Button>
            <Badge
              variant="outline"
              className="border-amber-300 bg-amber-50 text-amber-700 px-3 py-1 text-sm font-semibold"
            >
              {user?.shopName ?? user?.shopId ?? "Canteen"}
            </Badge>
          </div>
        </div>

        {/* Search + categories + reorder toggle */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search dishes…"
                className="pl-9 h-11 bg-card/90"
                disabled={reorderMode}
              />
            </div>
            {reorderMode ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setReorderMode(false); setReorderDirty(false); }}
                  disabled={reorderSaving}
                >
                  ยกเลิก
                </Button>
                <Button
                  size="sm"
                  onClick={saveReorder}
                  disabled={!reorderDirty || reorderSaving}
                  className="bg-amber-500 hover:bg-amber-600"
                >
                  <CheckIcon className="h-3 w-3 mr-1" />
                  {reorderSaving ? "…" : "บันทึก"}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReorderMode(true)}
                className="shrink-0"
              >
                <ArrowUpDown className="h-3 w-3 mr-1" />
                จัดลำดับ
              </Button>
            )}
          </div>
          {!reorderMode && (
            <CategoryTabs
              active={activeCategory}
              onChange={setActiveCategory}
              counts={categoryCounts}
            />
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-1 pb-24 lg:pb-2">
          {reorderMode ? (
            <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={products.map((p) => String(p.id))} strategy={rectSortingStrategy}>
                <ProductGrid
                  products={products}
                  lastAddedProductId={null}
                  onAdd={() => {}}
                  loading={productsLoading}
                  priceMode={cart.priceMode}
                  reorderMode
                />
              </SortableContext>
            </DndContext>
          ) : (
            <ProductGrid
              products={visibleProducts}
              lastAddedProductId={null}
              onAdd={handleProductTap}
              loading={productsLoading}
              priceMode={cart.priceMode}
              colorEditId={colorEditId}
              colorSaving={colorSaving}
              onOpenColorEdit={(id) => setColorEditId(id)}
              onCloseColorEdit={() => setColorEditId(null)}
              onSaveColor={saveProductColor}
            />
          )}
        </div>
      </div>

      {/* Desktop cart panel — visible ≥lg, hidden below */}
      <CanteenCart
        items={cart.items}
        subtotal={cart.subtotal}
        billDiscountMode={cart.billDiscountMode}
        billDiscountValue={cart.billDiscountValue}
        billDiscountAmount={cart.billDiscountAmount}
        total={cart.total}
        priceMode={cart.priceMode}
        priceFor={cart.priceFor}
        unitPriceFor={cart.unitPriceFor}
        onIncrement={cart.incrementLine}
        onDecrement={cart.decrementLine}
        onRemove={cart.removeLine}
        onSetLinePrice={cart.setLinePriceOverride}
        onSetLineDiscount={cart.setLineDiscount}
        lineDiscountAmountFor={cart.lineDiscountAmountFor}
        onOpenDiscount={() => setDiscountOpen(true)}
        onClearDiscount={cart.clearDiscount}
        onClearCart={cart.clearCart}
        onCharge={handleCharge}
        selectedMember={preSelectedMember}
        onClearMember={() => setPreSelectedMember(null)}
      />

      {/* Mobile floating cart trigger — visible <lg when cart has items */}
      {cart.items.length > 0 && (
        <Button
          onClick={() => setCartOpen(true)}
          className="lg:hidden fixed bottom-4 right-4 z-40 h-14 px-5 rounded-full text-base font-bold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-lg shadow-amber-400/50"
        >
          <ShoppingCart className="h-5 w-5 mr-2" />
          <span className="tabular-nums">
            ฿{cart.total.toFixed(0)} · {cart.items.reduce((s, i) => s + i.quantity, 0)}
          </span>
        </Button>
      )}

      {/* Mobile cart sheet */}
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col lg:hidden">
          <CanteenCart
            asSheet
            items={cart.items}
            subtotal={cart.subtotal}
            billDiscountMode={cart.billDiscountMode}
            billDiscountValue={cart.billDiscountValue}
            billDiscountAmount={cart.billDiscountAmount}
            total={cart.total}
            priceMode={cart.priceMode}
            priceFor={cart.priceFor}
            unitPriceFor={cart.unitPriceFor}
            onIncrement={cart.incrementLine}
            onDecrement={cart.decrementLine}
            onRemove={cart.removeLine}
            onSetLinePrice={cart.setLinePriceOverride}
            onSetLineDiscount={cart.setLineDiscount}
            lineDiscountAmountFor={cart.lineDiscountAmountFor}
            onOpenDiscount={() => setDiscountOpen(true)}
            onClearDiscount={cart.clearDiscount}
            onClearCart={cart.clearCart}
            onCharge={() => {
              setCartOpen(false);
              handleCharge();
            }}
            selectedMember={preSelectedMember}
            onClearMember={() => setPreSelectedMember(null)}
          />
        </SheetContent>
      </Sheet>

      {/* Menu option modal */}
      <MenuOptionModal
        shopId={CANTEEN_SHOP_ID}
        product={optionTarget}
        basePrice={optionTarget ? cart.priceFor(optionTarget) : 0}
        onClose={() => setOptionTarget(null)}
        onConfirm={handleOptionsConfirmed}
      />

      {/* Modals */}
      <DiscountModal
        open={discountOpen}
        onOpenChange={setDiscountOpen}
        subtotal={cart.subtotal}
        initialMode={cart.billDiscountMode}
        initialValue={cart.billDiscountValue}
        onApply={cart.setBillDiscount}
        onClear={cart.clearDiscount}
      />
      <PaymentMethodPicker
        open={methodPickerOpen}
        onOpenChange={setMethodPickerOpen}
        total={cart.total}
        methods={["wallet", "cash", "qr", "edc"]}
        onSelect={handleSelectMethod}
      />
      <RfidPaymentModal
        open={rfidOpen}
        onOpenChange={setRfidOpen}
        total={cart.total}
        onBack={() => {
          setRfidOpen(false);
          setPreSelectedMember(null);
          setMethodPickerOpen(true);
        }}
        onConfirm={handleConfirmWallet}
        confirming={confirming}
        preSelectedMember={preSelectedMember}
        onClearPreSelected={() => setPreSelectedMember(null)}
      />
      <CashPaymentModal
        open={cashOpen}
        onOpenChange={setCashOpen}
        total={cart.total}
        onBack={() => {
          setCashOpen(false);
          setMethodPickerOpen(true);
        }}
        onConfirm={handleConfirmCash}
        confirming={confirming}
      />
      <QrPaymentModal
        open={qrOpen}
        onOpenChange={setQrOpen}
        total={cart.total}
        onBack={() => {
          setQrOpen(false);
          setMethodPickerOpen(true);
        }}
        onConfirm={handleConfirmQr}
        confirming={confirming}
      />
      <DepartmentPaymentModal
        open={deptOpen}
        onOpenChange={setDeptOpen}
        total={cart.total}
        departments={departmentOptions}
        onBack={() => { setDeptOpen(false); setMethodPickerOpen(true); }}
        onConfirm={handleConfirmDept}
        confirming={confirming}
      />
      <ReceiptSuccessModal
        open={successOpen}
        onClose={() => setSuccessOpen(false)}
        receiptNumber={lastReceipt?.number ?? ""}
        amount={lastReceipt?.amount ?? 0}
        remainingBalance={lastReceipt?.remainingBalance ?? null}
        studentName={lastReceipt?.studentName ?? null}
        studentPhotoUrl={lastReceipt?.studentPhotoUrl ?? null}
        studentGrade={lastReceipt?.studentGrade ?? null}
      />
      <MemberSearchModal
        open={memberSearchOpen}
        onOpenChange={setMemberSearchOpen}
        onSelect={(member) => {
          setPreSelectedMember(member);
          setMemberSearchOpen(false);
        }}
      />
      <CardTapModal
        open={cardTapOpen}
        onOpenChange={setCardTapOpen}
        currentMember={preSelectedMember}
        onSelect={(member) => {
          setPreSelectedMember(member);
          setCardTapOpen(false);
        }}
      />
      <CashierTopupModal
        open={topupOpen}
        onOpenChange={setTopupOpen}
      />

      {/* Special item — cashier enters price before adding to cart */}
      <Dialog
        open={!!specialItemTarget}
        onOpenChange={(o) => { if (!o) setSpecialItemTarget(null); }}
      >
        <DialogContent
          className="sm:max-w-xs"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            setTimeout(() => specialItemInputRef.current?.focus(), 50);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("canteen.pos.setPrice")}</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              {specialItemTarget?.name} — {t("canteen.pos.enterPriceHint")}
            </p>
            <Input
              ref={specialItemInputRef}
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={specialItemPrice}
              onChange={(e) => setSpecialItemPrice(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const parsed = parseFloat(specialItemPrice);
                  if (!isNaN(parsed) && parsed >= 0 && specialItemTarget) {
                    cart.addSpecialItem(specialItemTarget, parsed);
                    setSpecialItemTarget(null);
                  }
                }
              }}
              className="text-lg text-right tabular-nums"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSpecialItemTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                const parsed = parseFloat(specialItemPrice);
                if (!isNaN(parsed) && parsed >= 0 && specialItemTarget) {
                  cart.addSpecialItem(specialItemTarget, parsed);
                  setSpecialItemTarget(null);
                }
              }}
              disabled={isNaN(parseFloat(specialItemPrice)) || parseFloat(specialItemPrice) < 0}
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-white"
            >
              {t("canteen.addToCart")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wallet limit exceeded — prominent AlertDialog */}
      <AlertDialog open={!!walletLimitError} onOpenChange={(o) => { if (!o) setWalletLimitError(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600">{t("canteen.pos.insufficientBalance")}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-foreground">
              {walletLimitError}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setWalletLimitError(null)}>
              {t("common.ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* RFID centered auto-dismiss notification */}
      {rfidNotif && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div
            key={rfidNotif.key}
            className={cn(
              "relative rounded-2xl px-8 py-6 shadow-2xl text-center min-w-[260px] max-w-[340px]",
              "animate-in fade-in zoom-in-95 duration-150 pointer-events-auto",
              rfidNotif.type === "success"
                ? "bg-amber-50 border-2 border-amber-300"
                : "bg-red-50 border-2 border-red-300",
            )}
          >
            <button
              onClick={() => {
                if (rfidNotifTimer.current) clearTimeout(rfidNotifTimer.current);
                setRfidNotif(null);
              }}
              className={cn(
                "absolute top-2 right-2 rounded-full p-1 hover:bg-black/10 transition-colors",
                rfidNotif.type === "success" ? "text-amber-500" : "text-red-400",
              )}
              aria-label="ปิด"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            {rfidNotif.type === "success" ? (
              <>
                <div className="flex justify-center mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                </div>
                <div className="text-xl font-bold text-amber-900 leading-tight">
                  {rfidNotif.title}
                </div>
                {rfidNotif.sub && (
                  <div className="text-2xl font-extrabold text-amber-600 mt-1 tabular-nums">
                    {rfidNotif.sub}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex justify-center mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                  </svg>
                </div>
                <div className="text-base font-semibold text-red-700">
                  {rfidNotif.title}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
