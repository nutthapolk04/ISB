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
  TouchSensor,
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
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { useDisplayBroadcast } from "@/hooks/useDisplayBroadcast";
import {
  cartToDisplayItems,
  payerForCustomer,
  payerForDepartment,
  payerForUser,
  paymentMethodForDisplay,
} from "@/lib/customerDisplay";
import { autoOpenCustomerDisplayWindow } from "@/lib/customerDisplayWindow";
import type { DisplayPayer } from "@/hooks/useDisplayBroadcast";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { printReceipt, type ReceiptApi } from "@/lib/printReceipt";
import { useCanteenCart, type CanteenProduct } from "@/hooks/useCanteenCart";
import type { SelectedOptionGroup } from "./canteen/menuOptionTypes";
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
import { EdcPaymentModal } from "./store/EdcPaymentModal";
import { ReceiptSuccessModal } from "./canteen/ReceiptSuccessModal";
import { DepartmentPaymentModal, type DepartmentOption } from "./store/DepartmentPaymentModal";
import { MemberSearchModal } from "./canteen/MemberSearchModal";
import { CardTapModal } from "./canteen/CardTapModal";
import { CashierTopupModal } from "@/components/CashierTopupModal";
import { UpToDateSaleButton } from "@/components/canteen/UpToDateSaleButton";
import { Switch } from "@/components/ui/switch";
import { Printer } from "lucide-react";
import { SpendingLimitChip } from "@/components/SpendingLimitChip";
import { useAutoPrint } from "@/hooks/useAutoPrint";

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
  short_name?: string | null;
}


interface CheckoutResponse {
  receipt_number: string;
  total: number;
}

export default function Canteen() {
  const { t, i18n } = useTranslation();
  const { user, hasRole } = useAuth();
  const [autoPrint, setAutoPrint] = useAutoPrint(`canteen:${user?.shopId ?? "default"}`);
  const schoolInfo = useSchoolInfo();

  // Pop the customer display once when entering the POS, on desktop only.
  // Multi-role users (manager+parent, etc.) reach the canteen via the Hub
  // tile, so deferring the popup to here avoids surprising them at login.
  const displayOpenedRef = useRef(false);
  useEffect(() => {
    if (displayOpenedRef.current) return;
    const isMobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
    if (isMobile) return;
    displayOpenedRef.current = true;
    // Guarded auto-open: only fires on stations with ≥2 monitors so single-
    // screen PCs / notebooks don't get a stray customer display window.
    void autoOpenCustomerDisplayWindow();
  }, []);
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

  // PointerSensor on its own dispatches via mouse + pen; touch events on
  // Windows POS terminals don't reliably trigger drag with it (browser
  // tends to capture the touch as a scroll). Add an explicit TouchSensor
  // with a long-press delay so a tap-to-select still works but holding
  // the card for ~250 ms initiates drag mode — clear enough mental model
  // for cashiers without accidental drags during normal POS browsing.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
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

  const enterReorderMode = async () => {
    try {
      const meta = await api.get<{ products_order_version?: number }>(`/shops/${CANTEEN_SHOP_ID}`);
      if (meta.products_order_version != null) setProductsOrderVersion(meta.products_order_version);
    } catch { /* use cached version */ }
    setReorderMode(true);
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
      toast.success(t("canteen.reorder.saved"), { duration: 1500 });
    } catch (e: any) {
      if (e?.status === 409 || e?.detail?.current_version) {
        toast.error(t("canteen.reorder.conflict"));
        const newVer = e?.detail?.current_version;
        if (newVer) setProductsOrderVersion(newVer);
      } else {
        toast.error(e instanceof ApiError ? e.detail : t("canteen.reorder.saveFailed"));
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
  const [shopDisplayName, setShopDisplayName] = useState<string | null>(null);
  const [productsLoading, setProductsLoading] = useState(true);
  const [search, setSearch] = useState("");
  // Per-shop pricing model — single-pricing canteens hide the Retail/Internal
  // toggle entirely. Defaults to dual until the shop meta loads.
  const [usesDualPricing, setUsesDualPricing] = useState(true);

  const [discountOpen, setDiscountOpen] = useState(false);
  // Customer display broadcast — drives the second-monitor screen.
  const display = useDisplayBroadcast();

  // Reset the customer-facing window to the standby rotation whenever the
  // cashier enters this POS page. Without this, a stale "review" / "success"
  // state from a previous session can stick around in the popup and hide the
  // image rotation until the cashier starts a new checkout.
  useEffect(() => {
    display.standby();
  }, [display]);

  const buildDisplayItems = () =>
    cartToDisplayItems(
      cart.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice:
          cart.priceMode === "internal"
            ? (i.internalPrice ?? i.price)
            : (i.priceOverride ?? i.price),
        discount: cart.lineDiscountAmountFor(i),
      })),
    );

  const [methodPickerOpen, setMethodPickerOpen] = useState(false);
  const [rfidOpen, setRfidOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [edcOpen, setEdcOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [memberSearchOpen, setMemberSearchOpen] = useState(false);
  const [cardTapOpen, setCardTapOpen] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [walletLimitError, setWalletLimitError] = useState<string | null>(null);
  // Pre-selected member from search (for "ready to pay" flow)
  const [preSelectedMember, setPreSelectedMember] = useState<StudentLookupResult | null>(null);
  // Increment to trigger spending chip refresh after successful checkout
  const [chipRefreshKey, setChipRefreshKey] = useState(0);

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
        const meta = await api.get<{ name?: string; allow_department_charge?: boolean; products_order_version?: number; uses_dual_pricing?: boolean }>(`/shops/${CANTEEN_SHOP_ID}`);
        if (!cancelled) {
          if (meta.name) setShopDisplayName(meta.name);
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

  // Receipt note (optional cashier memo). Mirrors the Store POS pattern —
  // gets attached to the checkout payload's `notes` field and cleared on
  // success so it doesn't carry over to the next order.
  const [receiptNote, setReceiptNote] = useState<string>("");

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

  // ── Price panels (replaces category tabs) ─────────────────────────────
  const [panels, setPanels] = useState<{ id: number; name: string; color: string | null }[]>([]);
  const [activePanelId, setActivePanelId] = useState<number | null>(null); // null = All
  // Cache of included product IDs per panel: panelId → Set<productId>
  const [panelProductIds, setPanelProductIds] = useState<Record<number, Set<number>>>({});
  // Cache of short-name overrides per panel: panelId → productId → short_name
  const [panelShortNames, setPanelShortNames] = useState<Record<number, Record<number, string>>>({});
  const [panelTabsLoading, setPanelTabsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPanelTabsLoading(true);
    api.get<{ id: number; name: string; color: string | null }[]>(
      `/shops/${CANTEEN_SHOP_ID}/price-panels`,
    ).then(async (data) => {
      if (cancelled) return;
      setPanels(data);
      // Pre-fetch all panel product IDs so counts are visible immediately
      await Promise.all(data.map(async (panel) => {
        try {
          const items = await api.get<{ product_id: number; included: boolean; short_name?: string | null }[]>(
            `/shops/${CANTEEN_SHOP_ID}/price-panels/${panel.id}/items`,
          );
          if (!cancelled) {
            const ids = new Set(items.filter((i) => i.included).map((i) => i.product_id));
            setPanelProductIds((prev) => ({ ...prev, [panel.id]: ids }));
            const snMap: Record<number, string> = {};
            items.forEach((i) => { if (i.short_name) snMap[i.product_id] = i.short_name; });
            setPanelShortNames((prev) => ({ ...prev, [panel.id]: snMap }));
          }
        } catch { /* tolerate */ }
      }));
    }).catch(() => {
      // panels optional — fall back to showing all
    }).finally(() => {
      if (!cancelled) setPanelTabsLoading(false);
    });
    return () => { cancelled = true; };
  }, [CANTEEN_SHOP_ID]);

  const fetchPanelProducts = async (panelId: number) => {
    if (panelProductIds[panelId]) return; // already cached
    try {
      const items = await api.get<{ product_id: number; included: boolean; short_name?: string | null }[]>(
        `/shops/${CANTEEN_SHOP_ID}/price-panels/${panelId}/items`,
      );
      const ids = new Set(items.filter((i) => i.included).map((i) => i.product_id));
      setPanelProductIds((prev) => ({ ...prev, [panelId]: ids }));
      const snMap: Record<number, string> = {};
      items.forEach((i) => { if (i.short_name) snMap[i.product_id] = i.short_name; });
      setPanelShortNames((prev) => ({ ...prev, [panelId]: snMap }));
    } catch {
      // tolerate — panel just shows all if fetch fails
    }
  };

  const handlePanelChange = async (panelId: number | null) => {
    setActivePanelId(panelId);
    if (panelId !== null) await fetchPanelProducts(panelId);
  };

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
  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const panelIds = activePanelId !== null ? panelProductIds[activePanelId] : null;
    return products.filter((p) => {
      if (panelIds && !panelIds.has(p.id)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.productCode.toLowerCase().includes(q)
      );
    });
  }, [products, search, activePanelId, panelProductIds]);

  // ── Checkout ───────────────────────────────────────────────────────────
  const doCheckout = async (
    backendPaymentMethod: "wallet" | "cash" | "other" | "edc" | "department",
    payer?:
      | { kind: "customer"; customerId: number }
      | { kind: "user"; userId: number }
      | { kind: "department"; departmentId: number },
    extras?: {
      cashReceived?: number;
      edcRefs?: { approval_code: string; terminal_ref?: string; masked_card?: string };
    },
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
        cash_received:
          backendPaymentMethod === "cash" && extras?.cashReceived !== undefined
            ? extras.cashReceived
            : undefined,
        edc_approval_code: extras?.edcRefs?.approval_code,
        edc_terminal_ref: extras?.edcRefs?.terminal_ref,
        edc_masked_card: extras?.edcRefs?.masked_card,
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
        notes: receiptNote.trim() || undefined,
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
    // Refresh spending limit chip after each successful checkout
    setChipRefreshKey((k) => k + 1);
    // Auto-print receipt — fires once per completed sale. Silent printing
    // requires Chromium launched with --kiosk-printing on the cashier station.
    // Skipped entirely when the per-station auto-print toggle is off.
    if (fullReceipt && autoPrint) {
      try {
        printReceipt(fullReceipt, schoolInfo, user?.shopName, "en");
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
    setReceiptNote("");
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
    else if (method === "edc") setEdcOpen(true);
    else if (method === "department") setDeptOpen(true);
    else setQrOpen(true);
  };

  const handleConfirmDept = async (deptId: number, _empCode: string | null) => {
    const amount = cart.total;
    // No DepartmentPayer lookup available here yet — show the department-
    // budget heading without the balance preview rather than blocking.
    display.processing({
      items: buildDisplayItems(),
      total: amount,
      payer: null,
      method: "department",
    });
    try {
      const res = await doCheckout("department", { kind: "department", departmentId: deptId });
      display.success({
        total: amount,
        payer: null,
        method: "department",
        receiptNumber: res.receipt_number,
      });
      finalizeSuccess(res.receipt_number, amount, null, null, res as unknown as ReceiptApi);
    } catch (e) {
      const reason = e instanceof ApiError ? e.detail : (e as any)?.message ?? "Payment could not be completed.";
      display.failed({ reason: String(reason), method: "department" });
      toast.error(t("checkout.failed", "Checkout failed"), {
        description: e instanceof ApiError ? e.detail : t("checkout.failedHint", "Please try again or check your network."),
      });
    }
  };

  const handleConfirmWallet = async (payer: WalletPayer) => {
    const amount = cart.total;
    // Resolve a DisplayPayer up-front so the customer screen can show the
    // balance preview while we wait for the backend.
    const displayPayer: DisplayPayer | null =
      payer.kind === "department"
        ? payerForDepartment(payer.department, amount)
        : payer.kind === "customer"
          ? payerForCustomer(payer.student, amount)
          : payerForUser(payer.user, amount);
    const displayMethod = payer.kind === "department" ? "department" : "wallet";
    display.processing({
      items: buildDisplayItems(),
      total: amount,
      payer: displayPayer,
      method: displayMethod,
    });
    try {
      if (payer.kind === "department") {
        const res = await doCheckout("department", {
          kind: "department",
          departmentId: payer.department.id,
        });
        display.success({
          total: amount,
          payer: displayPayer,
          method: "department",
          receiptNumber: res.receipt_number,
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
        display.success({
          total: amount,
          payer: displayPayer,
          method: "wallet",
          receiptNumber: res.receipt_number,
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
      display.success({
        total: amount,
        payer: displayPayer,
        method: "wallet",
        receiptNumber: res.receipt_number,
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
      const reason = e instanceof ApiError ? e.detail : (e as any)?.message ?? "Payment could not be completed.";
      display.failed({ reason: String(reason), method: displayMethod });
      if (e instanceof ApiError && e.code?.startsWith("EXCEEDS_NEGATIVE_CREDIT_LIMIT")) {
        setWalletLimitError(e.detail);
      } else {
        toast.error(t("checkout.failed", "Checkout failed"), {
        description: e instanceof ApiError ? e.detail : t("checkout.failedHint", "Please try again or check your network."),
      });
      }
    }
  };

  const handleConfirmCash = async (cashReceived: number) => {
    const amount = cart.total;
    display.processing({
      items: buildDisplayItems(),
      total: amount,
      payer: null,
      method: "cash",
    });
    try {
      const res = await doCheckout("cash", undefined, { cashReceived });
      display.success({
        total: amount,
        payer: null,
        method: "cash",
        receiptNumber: res.receipt_number,
      });
      finalizeSuccess(res.receipt_number, amount, null, null, res as unknown as ReceiptApi);
    } catch (e) {
      const reason = e instanceof ApiError ? e.detail : (e as any)?.message ?? "Payment could not be completed.";
      display.failed({ reason: String(reason), method: "cash" });
      toast.error(t("checkout.failed", "Checkout failed"), {
        description: e instanceof ApiError ? e.detail : t("checkout.failedHint", "Please try again or check your network."),
      });
    }
  };

  // QR PromptPay sale now lives entirely inside QrPaymentModal:
  // it creates a BAY intent, renders the real QR, polls the gateway, and
  // calls back through `onPaid` once the webhook produces a receipt.
  // (Old handleConfirmQr removed; the modal owns the checkout side-effect.)

  const handleConfirmEdc = async (refs: { approval_code: string; terminal_ref?: string; masked_card?: string }) => {
    setEdcOpen(false);
    const amount = cart.total;
    display.processing({
      items: buildDisplayItems(),
      total: amount,
      payer: null,
      method: "edc",
    });
    try {
      const res = await doCheckout("edc", undefined, { edcRefs: refs });
      display.success({
        total: amount,
        payer: null,
        method: "edc",
        receiptNumber: res.receipt_number,
      });
      finalizeSuccess(res.receipt_number, amount, null, null, res as unknown as ReceiptApi);
    } catch (e) {
      const reason = e instanceof ApiError ? e.detail : (e as any)?.message ?? "Payment could not be completed.";
      display.failed({ reason: String(reason), method: "edc" });
      toast.error(t("checkout.failed", "Checkout failed"), {
        description: e instanceof ApiError ? e.detail : t("checkout.failedHint", "Please try again or check your network."),
      });
    }
  };

  // Handle charge button - if member is pre-selected, charge directly
  const handleCharge = async () => {
    if (preSelectedMember) {
      // Direct charge for pre-selected member (wallet or department)
      const amount = cart.total;
      const displayPayer = payerForCustomer(preSelectedMember, amount);
      const displayMethod =
        preSelectedMember.customer_kind === "department" ? "department" : "wallet";
      display.processing({
        items: buildDisplayItems(),
        total: amount,
        payer: displayPayer,
        method: displayMethod,
      });
      setConfirming(true);
      try {
        const currentBalance = Number(preSelectedMember.wallet_balance ?? 0);
        // Department payer — use dept checkout path
        if (preSelectedMember.customer_kind === "department") {
          const res = await doCheckout("department", {
            kind: "department",
            departmentId: preSelectedMember.id,
          });
          display.success({
            total: amount,
            payer: displayPayer,
            method: "department",
            receiptNumber: res.receipt_number,
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
        display.success({
          total: amount,
          payer: displayPayer,
          method: "wallet",
          receiptNumber: res.receipt_number,
        });
        finalizeSuccess(
          res.receipt_number,
          amount,
          currentBalance - amount,
          preSelectedMember,
          res as unknown as ReceiptApi,
        );
        setPreSelectedMember(null);
      } catch (e) {
        const reason = e instanceof ApiError ? e.detail : (e as any)?.message ?? "Payment could not be completed.";
        display.failed({ reason: String(reason), method: displayMethod });
        if (e instanceof ApiError && e.code?.startsWith("EXCEEDS_NEGATIVE_CREDIT_LIMIT")) {
          setWalletLimitError(e.detail);
        } else {
          toast.error(t("checkout.failed", "Checkout failed"), {
        description: e instanceof ApiError ? e.detail : t("checkout.failedHint", "Please try again or check your network."),
      });
        }
      } finally {
        setConfirming(false);
      }
    } else {
      // No member selected — broadcast the order to the second monitor so
      // the customer sees it before the cashier picks a payment method,
      // then show the picker.
      display.review({
        items: buildDisplayItems(),
        total: cart.total,
        payer: null,
      });
      setMethodPickerOpen(true);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="canteen-layout">
      {/* Main — catalog */}
      <div className="canteen-content">
        {/* Header */}
        <div className="page-header flex flex-wrap items-center gap-2">
          {/* Search + reorder */}
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search dishes…"
              className="pl-9 h-9 bg-card/90"
              disabled={reorderMode}
            />
          </div>
          {reorderMode ? (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setReorderMode(false); setReorderDirty(false); }}
                disabled={reorderSaving}
              >
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={saveReorder}
                disabled={!reorderDirty || reorderSaving}
                className="bg-amber-500 hover:bg-amber-600"
              >
                <CheckIcon className="h-3 w-3 mr-1" />
                {reorderSaving ? "…" : t("common.save")}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void enterReorderMode()}
              className="shrink-0"
            >
              <ArrowUpDown className="h-3 w-3 mr-1" />
              {t("canteen.reorder.enter")}
            </Button>
          )}
          <div className="flex items-center gap-2 shrink-0">
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
              onClick={() => setMemberSearchOpen(true)}
              className="gap-1.5"
            >
              <UserSearch className="h-4 w-4" />
              <span className="hidden sm:inline">{t("canteen.pos.searchMember")}</span>
            </Button>
            {hasRole("cashier", "manager", "admin") && CANTEEN_SHOP_ID && (
              <UpToDateSaleButton
                shopId={CANTEEN_SHOP_ID}
                shopName={user?.shopName}
                schoolInfo={schoolInfo}
              />
            )}
            <label
              className="inline-flex items-center gap-2 rounded-full border border-input bg-background px-3 py-1.5 text-xs cursor-pointer select-none hover:bg-muted/50 transition"
              title={t("pos.autoPrintTooltip", "Auto-print receipt after each sale")}
            >
              <Printer className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="hidden sm:inline font-medium">
                {t("pos.autoPrint", "Auto-print")}
              </span>
              <Switch
                checked={autoPrint}
                onCheckedChange={setAutoPrint}
                aria-label={t("pos.autoPrint", "Auto-print")}
              />
            </label>
            <Badge
              variant="outline"
              className="border-amber-300 bg-amber-50 text-amber-700 px-3 py-1 text-sm font-semibold"
            >
              {shopDisplayName ?? user?.shopName ?? user?.shopId ?? "Canteen"}
            </Badge>
          </div>
        </div>

        {/* Panel tabs (replaces category tabs) */}
        {!reorderMode && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {/* All tab */}
            <button
              type="button"
              onClick={() => handlePanelChange(null)}
              className={cn(
                "shrink-0 rounded-full px-5 py-2 text-sm font-semibold transition-all border border-transparent",
                activePanelId === null
                  ? "bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-md shadow-amber-300/40"
                  : "bg-card/80 text-muted-foreground border-amber-100 hover:bg-amber-50 hover:text-amber-700",
              )}
            >
              {t("canteen.tabAll", "All")}
              <span className={cn(
                "ml-2 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs",
                activePanelId === null ? "bg-white/25" : "bg-muted",
              )}>
                {products.length}
              </span>
            </button>

            {/* Panel tabs */}
            {!panelTabsLoading && panels.map((panel) => {
              const isActive = activePanelId === panel.id;
              const count = panelProductIds[panel.id]?.size ?? "…";
              return (
                <button
                  key={panel.id}
                  type="button"
                  onClick={() => handlePanelChange(panel.id)}
                  className={cn(
                    "shrink-0 rounded-full px-5 py-2 text-sm font-semibold transition-all border border-transparent",
                    isActive
                      ? "bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-md shadow-amber-300/40"
                      : "bg-card/80 text-muted-foreground border-amber-100 hover:bg-amber-50 hover:text-amber-700",
                  )}
                >
                  {panel.name}
                  <span className={cn(
                    "ml-2 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs",
                    isActive ? "bg-white/25" : "bg-muted",
                  )}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Today's spending limit — shown when member is scanned */}
        {preSelectedMember && (
          <div className="px-1 lg:hidden">
            <SpendingLimitChip
              shopId={CANTEEN_SHOP_ID}
              payerId={
                preSelectedMember.user_id != null
                  ? { kind: "user", id: preSelectedMember.user_id }
                  : { kind: "customer", id: preSelectedMember.id }
              }
              refreshKey={chipRefreshKey}
            />
          </div>
        )}

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
              shortNames={activePanelId != null ? panelShortNames[activePanelId] : undefined}
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
        headerSlot={
          <SpendingLimitChip
            shopId={CANTEEN_SHOP_ID}
            payerId={
              preSelectedMember
                ? preSelectedMember.user_id != null
                  ? { kind: "user", id: preSelectedMember.user_id }
                  : { kind: "customer", id: preSelectedMember.id }
                : null
            }
            refreshKey={chipRefreshKey}
          />
        }
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
        note={receiptNote}
        onNoteChange={setReceiptNote}
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
            note={receiptNote}
            onNoteChange={setReceiptNote}
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
        buildCartPayload={() => ({
          transaction_mode: cart.priceMode === "internal" ? "internal_issue" : "sale",
          payer_kind: "customer",
          shop_id: CANTEEN_SHOP_ID,
          discount: cart.billDiscountAmount,
          notes: receiptNote.trim() || undefined,
          items: cart.items.map((i) => ({
            product_variant_id: i.id,
            quantity: i.quantity,
            unit_price: cart.priceMode === "internal" ? i.internalPrice : i.price,
            price_override: i.priceOverride ?? null,
            discount: cart.lineDiscountAmountFor(i),
            options: i.selectedOptions.flatMap((g) =>
              g.options.map((o) => ({
                option_id: o.id,
                quantity: o.quantity,
              })),
            ),
          })),
        })}
        onPaid={(info) => {
          setQrOpen(false);
          const receiptNumber = info.receiptNumber ?? "";
          display.success({
            total: cart.total,
            payer: null,
            method: "qr",
            receiptNumber,
          });
          finalizeSuccess(receiptNumber, cart.total, null, null, undefined);
        }}
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
      <EdcPaymentModal
        open={edcOpen}
        onOpenChange={setEdcOpen}
        total={cart.total}
        onBack={() => { setEdcOpen(false); setMethodPickerOpen(true); }}
        onConfirm={handleConfirmEdc}
        confirming={confirming}
      />
      <ReceiptSuccessModal
        // The cashier dismissing the success modal frees the customer
        // display to return to standby right away (no need to wait out
        // the 5-second auto-dwell).
        open={successOpen}
        onClose={() => {
          setSuccessOpen(false);
          display.standby();
        }}
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
              aria-label={t("common.close")}
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
