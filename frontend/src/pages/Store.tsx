import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IconButton } from "@/components/IconButton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { printReceipt, type ReceiptApi } from "@/lib/printReceipt";
import {
  Plus,
  Minus,
  Trash2,
  ScanBarcode,
  ShoppingCart,
  Package,
  CreditCard,
  UserSearch,
  Wallet,
  UserCircle2,
  X,
  Palette,
  GripVertical,
  ArrowUpDown,
  Check,
  Printer,
  Loader2,
} from "lucide-react";
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
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "@/components/ui/sonner";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

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
import { PaymentMethodPicker, type CanteenPaymentMethod } from "./canteen/PaymentMethodPicker";
import { CashPaymentModal } from "./canteen/CashPaymentModal";
import { QrPaymentModal } from "./canteen/QrPaymentModal";
import { RfidPaymentModal, type WalletPayer, type StudentLookupResult, type UserPayerLookup } from "./canteen/RfidPaymentModal";
import { ReceiptSuccessModal } from "./canteen/ReceiptSuccessModal";
import { DepartmentPaymentModal, type DepartmentOption } from "./store/DepartmentPaymentModal";
import { EdcPaymentModal } from "./store/EdcPaymentModal";
import UserPicker from "@/components/UserPicker";
import { MemberSearchModal } from "./canteen/MemberSearchModal";
import { CashierTopupModal } from "@/components/CashierTopupModal";
import { Switch } from "@/components/ui/switch";
import { useAutoPrint } from "@/hooks/useAutoPrint";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PricePanel {
  id: number;
  name: string;
  color: string | null;
}

const panelColorClass: Record<string, string> = {
  blue: "bg-blue-100 text-blue-700 border-blue-300",
  green: "bg-green-100 text-green-700 border-green-300",
  orange: "bg-orange-100 text-orange-700 border-orange-300",
  red: "bg-red-100 text-red-700 border-red-300",
  purple: "bg-purple-100 text-purple-700 border-purple-300",
  gray: "bg-gray-100 text-gray-700 border-gray-300",
};

interface ExtraBarcode {
  id: number;
  barcode: string;
  label: string | null;
}

interface Product {
  id: number;
  productCode: string;
  barcode: string;
  name: string;
  price: number;
  internalPrice?: number;
  stock: number;
  category: string;
  subMerchantId: string;
  photoUrl?: string | null;
  color?: string | null;
  extraBarcodes?: ExtraBarcode[];
  // Bundle / Grade-Set fields (only present when isBundle=true)
  isBundle?: boolean;
  bundleId?: number;
}

type DiscountMode = "amount" | "percent";

// ── Per-item discount shortcut popover (same UX as canteen) ─────────────────
const DISCOUNT_SHORTCUTS_PCT = [5, 10, 15, 20, 25, 30];
const DISCOUNT_SHORTCUTS_AMT = [5, 10, 15, 20, 25];

function DiscountShortcutPopover({
  itemId,
  currentValue,
  currentMode,
  onUpdate,
}: {
  itemId: string;
  currentValue: number | undefined;
  currentMode: DiscountMode | undefined;
  onUpdate: (id: string, value: number | null, mode: DiscountMode) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Local mode lets the user toggle %↔฿ inside the popover without saving
  // a stale discount. Resets to the persisted mode each time the popover opens.
  const [localMode, setLocalMode] = useState<DiscountMode>(currentMode ?? "percent");
  useEffect(() => {
    if (open) setLocalMode(currentMode ?? "percent");
  }, [open, currentMode]);
  const mode = localMode;
  const shortcuts = mode === "percent" ? DISCOUNT_SHORTCUTS_PCT : DISCOUNT_SHORTCUTS_AMT;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "h-7 px-2.5 text-xs font-bold rounded border bg-background transition-colors",
            mode === "percent"
              ? "border-amber-400 text-amber-700 hover:bg-amber-50"
              : "border-border text-foreground hover:bg-muted",
          )}
        >
          {mode === "percent" ? "%" : "฿"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4" align="start" side="top" sideOffset={6}>
        <p className="mb-3 text-sm font-semibold text-muted-foreground">
          {t("store.cart.discountHeader")} {mode === "percent" ? "%" : "฿"}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {shortcuts.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => { onUpdate(itemId, q, mode); setOpen(false); }}
              className={cn(
                "h-12 min-w-[4.5rem] rounded-lg border text-base font-bold transition-colors",
                currentValue === q && currentMode === mode
                  ? "border-amber-500 bg-amber-500 text-white"
                  : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
              )}
            >
              {mode === "percent" ? `${q}%` : `฿${q}`}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => { onUpdate(itemId, null, mode); setOpen(false); }}
            className="flex-1 h-10 rounded-lg border border-border bg-background text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Clear / 0
          </button>
          <button
            type="button"
            onClick={() => setLocalMode(mode === "percent" ? "amount" : "percent")}
            className="h-10 px-4 rounded-lg border border-border bg-background text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            {mode === "percent" ? t("store.cart.useBaht") : t("store.cart.usePercent")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface CartItem extends Product {
  quantity: number;
  discountValue?: number;
  discountMode?: DiscountMode;
  priceOverride?: number | null;
}

interface LastReceipt {
  receiptNumber: string;
  amount: number;
  remainingBalance?: number;
  studentName?: string;
  studentPhotoUrl?: string;
  studentGrade?: string;
}

// ── Sortable card wrapper (must be defined outside Store to avoid hook remounts) ──

function SortableCard({
  id,
  reorderMode,
  children,
}: {
  id: number;
  reorderMode: boolean;
  children: (handleProps: React.HTMLAttributes<HTMLElement>, isDragging: boolean) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(id) });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        position: "relative",
      }}
    >
      {children(reorderMode ? { ...attributes, ...listeners } : {}, isDragging)}
    </div>
  );
}

const Store = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [autoPrint, setAutoPrint] = useAutoPrint(`store:${user?.shopId ?? "default"}`);
  const schoolInfo = useSchoolInfo();

  // ── Products + shop metadata ────────────────────────────────────────────
  const [allProducts, setAllProducts] = useState<Product[]>([]);

  // ── Product color editing (quick-edit palette on card) ──────────────────
  const [colorEditId, setColorEditId] = useState<number | null>(null);
  const [colorEditValue, setColorEditValue] = useState("#e2e8f0");
  const [colorSaving, setColorSaving] = useState(false);

  const saveProductColor = async (product: Product, color: string | null) => {
    setColorSaving(true);
    try {
      await api.patch(`/shops/${product.subMerchantId}/products/${product.id}`, { color });
      setAllProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, color } : p)),
      );
      toast.success(t("store.colorSaved"));
      setColorEditId(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : t("store.colorSaveFailed"));
    } finally {
      setColorSaving(false);
    }
  };
  // ── Product reorder ─────────────────────────────────────────────────────
  const [reorderMode, setReorderMode] = useState(false);
  const [reorderDirty, setReorderDirty] = useState(false);
  const [sortVersions, setSortVersions] = useState<Record<string, number>>({});
  const [reorderSaving, setReorderSaving] = useState(false);
  const canManageOrder = user?.role === "admin" || user?.role === "manager" || user?.role === "cashier";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setAllProducts((prev) => {
      const sid = user?.shopId;
      const shopProds = sid ? prev.filter((p) => p.subMerchantId === sid) : prev;
      const others = sid ? prev.filter((p) => p.subMerchantId !== sid) : [];
      const oldIdx = shopProds.findIndex((p) => String(p.id) === String(active.id));
      const newIdx = shopProds.findIndex((p) => String(p.id) === String(over.id));
      if (oldIdx === -1 || newIdx === -1) return prev;
      setReorderDirty(true);
      return [...arrayMove(shopProds, oldIdx, newIdx), ...others];
    });
  };

  const enterReorderMode = async () => {
    const sid = user?.shopId;
    if (!sid) { setReorderMode(true); return; }
    try {
      const meta = await api.get<{ products_order_version?: number }>(`/shops/${sid}`);
      if (meta.products_order_version != null) {
        setSortVersions((prev) => ({ ...prev, [sid]: meta.products_order_version! }));
      }
    } catch { /* use cached version */ }
    setReorderMode(true);
  };

  const saveReorder = async () => {
    const sid = user?.shopId;
    if (!sid) return;
    setReorderSaving(true);
    try {
      const shopProds = allProducts.filter((p) => p.subMerchantId === sid);
      const sortMap: Record<string, number> = {};
      shopProds.forEach((p, idx) => { sortMap[String(p.id)] = idx + 1; });
      const version = sortVersions[sid] ?? 1;
      const result = await api.post<{ version: number; updated: number }>(
        `/shops/${sid}/products/reorder`,
        { version, sort_map: sortMap },
      );
      setSortVersions((prev) => ({ ...prev, [sid]: result.version }));
      setReorderMode(false);
      setReorderDirty(false);
      toast.success(t("store.orderSaved"));
    } catch (e: any) {
      if (e?.status === 409 || e?.detail?.current_version) {
        toast.error(t("store.orderConflict"));
        const newVer = e?.detail?.current_version;
        if (newVer && sid) setSortVersions((prev) => ({ ...prev, [sid]: newVer }));
      } else {
        toast.error(e instanceof ApiError ? e.detail : t("store.orderSaveFailed"));
      }
    } finally {
      setReorderSaving(false);
    }
  };

  const [shopsMeta, setShopsMeta] = useState<Array<{ id: string; allow_department_charge: boolean; products_order_version?: number }>>([]);

  // ── Price panels ────────────────────────────────────────────────────────
  const [panels, setPanels] = useState<PricePanel[]>([]);
  const [activePanelId, setActivePanelId] = useState<number | null>(null);
  // panelPrices: panelId -> productId -> price
  const [panelPrices, setPanelPrices] = useState<Record<number, Record<number, number>>>({});
  // panelShortNames: panelId -> productId -> short_name
  const [panelShortNames, setPanelShortNames] = useState<Record<number, Record<number, string>>>({});
  // panelIncluded: panelId -> Set of included product ids
  const [panelIncluded, setPanelIncluded] = useState<Record<number, Set<number>>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result: Product[] = [];
      let shopsList: Array<{ id: string; allow_department_charge: boolean }> = [];
      try {
        shopsList = await api.get<Array<{ id: string; allow_department_charge: boolean; products_order_version?: number }>>(
          "/shops/?active_only=true",
        );
        if (!cancelled) {
          setShopsMeta(shopsList);
          const vmap: Record<string, number> = {};
          shopsList.forEach((s) => { if (s.products_order_version) vmap[s.id] = s.products_order_version; });
          setSortVersions(vmap);
        }
      } catch { /* ignore */ }

      const shopIds: string[] = user?.shopId ? [user.shopId] : shopsList.map((s) => s.id);
      for (const sid of shopIds) {
        try {
          const data = await api.get<any[]>(`/shops/${sid}/products`);
          result.push(
            ...data.map((p: any) => ({
              id: p.id,
              productCode: p.product_code,
              barcode: p.barcode ?? "",
              name: p.name,
              price: p.external_price,
              internalPrice: p.internal_price,
              stock: p.stock,
              category: p.category,
              subMerchantId: p.shop_id,
              photoUrl: p.photo_url ?? null,
              color: p.color ?? null,
              extraBarcodes: p.extra_barcodes ?? [],
            })),
          );
        } catch { /* shop unavailable */ }

        // ── Bundles for this shop ──────────────────────────────────────
        try {
          const bundles = await api.get<any[]>(`/shops/${sid}/bundles`);
          result.push(
            ...bundles.map((b: any) => ({
              // Use a negative ID space to avoid collision with real product IDs.
              // The bundleId field carries the real bundle PK.
              id: -(b.id),
              productCode: b.bundle_code,
              barcode: b.bundle_code,
              name: b.name,
              price: b.external_price,
              internalPrice: b.internal_price ?? b.external_price,
              // Bundles don't have a single stock counter — use a large sentinel
              // so the "out of stock" badge never triggers for bundles.
              stock: 9999,
              category: "Bundle",
              subMerchantId: sid,
              photoUrl: b.photo_url ?? null,
              color: b.color ?? null,
              isBundle: true,
              bundleId: b.id,
            })),
          );
        } catch { /* bundles unavailable — tolerate */ }
      }
      if (!cancelled) setAllProducts(result);
    })();
    return () => { cancelled = true; };
  }, [user?.shopId]);

  // ── Fetch price panels for shop-scoped users ────────────────────────────
  useEffect(() => {
    if (!user?.shopId) return;
    let cancelled = false;
    (async () => {
      try {
        const panelList = await api.get<PricePanel[]>(`/shops/${user.shopId}/price-panels`);
        if (cancelled) return;
        setPanels(panelList);
        // Fetch items for each panel
        const priceMap: Record<number, Record<number, number>> = {};
        const snameMap: Record<number, Record<number, string>> = {};
        const includedMap: Record<number, Set<number>> = {};
        await Promise.all(
          panelList.map(async (panel) => {
            try {
              const items = await api.get<Array<{ product_id: number; panel_price: number | null; short_name: string | null; included: boolean }>>(
                `/shops/${user.shopId}/price-panels/${panel.id}/items`,
              );
              const productMap: Record<number, number> = {};
              const snMap: Record<number, string> = {};
              const includedSet = new Set<number>();
              items.forEach((item) => {
                if (item.panel_price != null) productMap[item.product_id] = item.panel_price;
                if (item.short_name) snMap[item.product_id] = item.short_name;
                if (item.included !== false) includedSet.add(item.product_id);
              });
              priceMap[panel.id] = productMap;
              snameMap[panel.id] = snMap;
              includedMap[panel.id] = includedSet;
            } catch { /* panel fetch failed — skip */ }
          }),
        );
        if (!cancelled) {
          setPanelPrices(priceMap);
          setPanelShortNames(snameMap);
          setPanelIncluded(includedMap);
        }
      } catch { /* shop has no panels — tolerate */ }
    })();
    return () => { cancelled = true; };
  }, [user?.shopId]);

  // ── Departments (for payment dropdown) ──────────────────────────────────
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<DepartmentOption[]>("/departments/");
        if (!cancelled) setDepartmentOptions(data);
      } catch { /* tolerate */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Refs ────────────────────────────────────────────────────────────────
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const specialItemInputRef = useRef<HTMLInputElement>(null);

  // ── Cart ────────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([]);
  const [lastAddedId, setLastAddedId] = useState<number | null>(null);

  // ── Browse + search ─────────────────────────────────────────────────────
  const [gridCategory, setGridCategory] = useState<string>("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // ── Pricing ─────────────────────────────────────────────────────────────
  const [priceMode, setPriceMode] = useState<"retail" | "internal">("retail");
  // Internal-issue mode requires identifying who took the goods.
  const [requesterUserId, setRequesterUserId] = useState<number | null>(null);

  // ── Bill discount ───────────────────────────────────────────────────────
  const [billDiscountValue, setBillDiscountValue] = useState<string>("");
  const [billDiscountMode, setBillDiscountMode] = useState<DiscountMode>("amount");

  // ── Modal pipeline state ────────────────────────────────────────────────
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [methodPickerOpen, setMethodPickerOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [edcOpen, setEdcOpen] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [memberSearchOpen, setMemberSearchOpen] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<LastReceipt | null>(null);
  const [walletLimitError, setWalletLimitError] = useState<string | null>(null);
  // Pre-selected member from search (for direct wallet charge)
  const [preSelectedMember, setPreSelectedMember] = useState<StudentLookupResult | null>(null);

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
  // Keystrokes go here when no input/textarea has focus. Click the search box
  // to type manually — focus returns to body on blur and RFID resumes.
  const rfidBuffer = useRef<string>("");
  const rfidLastKey = useRef<number>(0);

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
      // If the user has explicitly focused a text input (search box, dialog field,
      // price input, etc.), let keys flow through normally. The RFID handler only
      // acts when the page has no focused input.
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) {
        return;
      }

      const now = Date.now();
      const gap = now - rfidLastKey.current;

      if (e.key === "Enter") {
        if (rfidBuffer.current.length >= 3) {
          e.preventDefault();
          e.stopPropagation();
          const captured = rfidBuffer.current;
          rfidBuffer.current = "";
          rfidLastKey.current = 0;
          void lookupAndSet(captured);
        } else {
          rfidBuffer.current = "";
        }
        return;
      }

      if (e.key.length !== 1) return;

      // Reset stale buffer if there's been a long pause (>500ms since last key)
      if (gap > 500 && rfidBuffer.current.length > 0) {
        rfidBuffer.current = "";
      }

      rfidLastKey.current = now;
      rfidBuffer.current += e.key;

      // Always intercept — page has no focused input, so all keystrokes belong to RFID.
      e.preventDefault();
      e.stopPropagation();
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  // Special item (price=0) — cashier must enter price before adding
  const [specialItemTarget, setSpecialItemTarget] = useState<Product | null>(null);
  const [specialItemPrice, setSpecialItemPrice] = useState("");

  // ── Department charge gating ────────────────────────────────────────────
  const canUseDeptCharge = useMemo(() => {
    if (shopsMeta.length === 0) return true;
    const cartShopIds = new Set(cart.map((i) => i.subMerchantId).filter(Boolean) as string[]);
    if (cartShopIds.size > 0) {
      return Array.from(cartShopIds).every(
        (sid) => shopsMeta.find((s) => s.id === sid)?.allow_department_charge === true,
      );
    }
    if (user?.shopId) {
      return shopsMeta.find((s) => s.id === user.shopId)?.allow_department_charge === true;
    }
    return shopsMeta.some((s) => s.allow_department_charge);
  }, [shopsMeta, cart, user?.shopId]);

  // ── Outside click closes search dropdown ────────────────────────────────
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Search input no longer auto-focuses — keystrokes go to RFID handler by default.
  // User must click the search box to type a barcode/name manually.

  // ── Derived ─────────────────────────────────────────────────────────────
  const suggestions = searchTerm.trim()
    ? allProducts
        .filter((p) => {
          const q = searchTerm.toLowerCase();
          return (
            p.barcode.toLowerCase().includes(q) ||
            p.productCode.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q) ||
            (p.extraBarcodes ?? []).some((b) => b.barcode.toLowerCase().includes(q))
          );
        })
        .slice(0, 6)
    : [];

  // Panel-aware price lookup for a product (used when adding to cart)
  const getPrice = (p: Product): number => {
    if (activePanelId != null && panelPrices[activePanelId]?.[p.id] != null) {
      return panelPrices[activePanelId][p.id];
    }
    return p.price;
  };

  const getPriceForItem = (item: CartItem) => {
    if (item.priceOverride != null) return item.priceOverride;
    return priceMode === "internal" ? (item.internalPrice ?? item.price) : item.price;
  };

  const getItemDiscountAmount = (item: CartItem): number => {
    const val = item.discountValue ?? 0;
    if (val <= 0) return 0;
    const gross = getPriceForItem(item) * item.quantity;
    if (item.discountMode === "percent") {
      return Math.min(gross, Math.round(((gross * val) / 100) * 100) / 100);
    }
    return Math.min(gross, val);
  };

  const getItemLineTotal = (item: CartItem): number => {
    const gross = getPriceForItem(item) * item.quantity;
    // Refund lines (qty<0) produce a negative gross; per-item discount is
    // still subtracted but cannot make the magnitude flip sign.
    const discount = getItemDiscountAmount(item);
    if (gross < 0) return gross + discount;
    return Math.max(0, gross - discount);
  };

  const subtotal = cart.reduce((s, i) => s + getItemLineTotal(i), 0);
  const itemCount = cart.reduce((s, i) => s + i.quantity, 0);
  const billDiscountAmount = (() => {
    const val = parseFloat(billDiscountValue);
    if (!val || val <= 0 || subtotal <= 0) return 0;
    if (billDiscountMode === "percent") {
      return Math.min(subtotal, Math.round(((subtotal * val) / 100) * 100) / 100);
    }
    return Math.min(subtotal, val);
  })();
  // Allow total to be negative when refund lines outweigh sale lines —
  // the cashier owes that amount back to the customer.
  const total = subtotal - billDiscountAmount;

  // ── Cart actions ────────────────────────────────────────────────────────
  const addToCart = useCallback(
    (product: Product) => {
      // Special items (price=0) must have a cashier-entered price first.
      // Bundles always have a real price so we skip this check for them.
      if (product.price === 0 && !product.isBundle) {
        setSpecialItemTarget(product);
        setSpecialItemPrice("");
        return;
      }
      // Panel prices only apply to regular products (not bundles).
      const panelPrice =
        !product.isBundle && activePanelId != null && panelPrices[activePanelId]?.[product.id] != null
          ? panelPrices[activePanelId][product.id]
          : null;
      setCart((prev) => {
        const existing = prev.find((i) => i.id === product.id);
        if (existing) {
          return prev.map((i) => (i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i));
        }
        return [...prev, { ...product, quantity: 1, priceOverride: panelPrice }];
      });
      setLastAddedId(product.id);
    },
    [t, activePanelId, panelPrices],
  );

  const updateQuantity = (id: number, change: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id !== id) return item;
          const next = item.quantity + change;
          // Allow negative qty for refund-via-POS, but skip the zero crossing
          // so a single tap from -1 doesn't reach 0 and leave a useless line.
          if (next === 0) return null;
          return { ...item, quantity: next };
        })
        .filter((item): item is CartItem => item !== null),
    );
  };

  const removeFromCart = (id: number) => {
    setCart((prev) => prev.filter((i) => i.id !== id));
    toast.success(t("store.removedFromCart"));
  };

  const clearCart = () => {
    setCart([]);
    setLastAddedId(null);
    setBillDiscountValue("");
    setPreSelectedMember(null);
    toast.success(t("store.cartCleared"));
  };

  // ── Search handlers ─────────────────────────────────────────────────────
  const commitSuggestion = (product: Product) => {
    addToCart(product);
    setSearchTerm("");
    setDropdownOpen(false);
    setHighlightedIndex(0);
    // Blur search so RFID handler resumes (user can tap card immediately for next item)
    searchInputRef.current?.blur();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setSearchTerm("");
      setDropdownOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, suggestions.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key !== "Enter" || !searchTerm.trim()) return;

    const q = searchTerm.trim();
    const byBarcode = allProducts.find(
      (p) =>
        p.barcode.toLowerCase() === q.toLowerCase() ||
        (p.extraBarcodes ?? []).some((b) => b.barcode.toLowerCase() === q.toLowerCase())
    );
    if (byBarcode) {
      commitSuggestion(byBarcode);
      return;
    }
    const byCode = allProducts.find((p) => p.productCode.toLowerCase() === q.toLowerCase());
    if (byCode) {
      commitSuggestion(byCode);
      return;
    }
    if (suggestions.length > 0) {
      commitSuggestion(suggestions[highlightedIndex] ?? suggestions[0]);
      return;
    }
    toast.error(t("store.productNotFound"));
  };

  // ── Checkout ────────────────────────────────────────────────────────────
  interface CheckoutCtx {
    payer?: WalletPayer;
    deptId?: number;
    empCode?: string | null;
    edcRefs?: { approval_code: string; terminal_ref?: string; masked_card?: string };
    cashReceived?: number;
  }

  const doCheckout = async (method: CanteenPaymentMethod, ctx: CheckoutCtx = {}) => {
    setConfirming(true);
    try {
      const isWallet = method === "wallet";
      const isDept = method === "department";
      const isEdc = method === "edc";

      let backendMethod: string;
      let payerKind: "customer" | "user" | "department" = "customer";
      let customer_id: number | undefined;
      let payer_user_id: number | undefined;
      let payer_department_id: number | undefined;
      let studentNameForReceipt: string | undefined;
      let studentPhotoForReceipt: string | undefined;
      let studentGradeForReceipt: string | undefined;

      if (isWallet && ctx.payer) {
        if (ctx.payer.kind === "customer") {
          backendMethod = "wallet";
          payerKind = "customer";
          customer_id = ctx.payer.student.id;
          studentNameForReceipt = ctx.payer.student.name;
          studentPhotoForReceipt = ctx.payer.student.photo_url ?? undefined;
          studentGradeForReceipt = ctx.payer.student.grade ?? undefined;
        } else {
          backendMethod = "wallet";
          payerKind = "user";
          payer_user_id = ctx.payer.user.user_id;
          studentNameForReceipt = ctx.payer.user.full_name;
          studentPhotoForReceipt = ctx.payer.user.photo_url ?? undefined;
        }
      } else if (isDept) {
        backendMethod = "department";
        payerKind = "department";
        payer_department_id = ctx.deptId;
      } else if (isEdc) {
        backendMethod = "edc";
      } else if (method === "cash") {
        backendMethod = "cash";
      } else {
        backendMethod = "other";
      }

      if (priceMode === "internal" && !requesterUserId) {
        toast.error(t("requisition.errorRequester", "Please select a requester"));
        setConfirming(false);
        return;
      }

      const payload = {
        transaction_mode: priceMode === "internal" ? "internal_issue" : "sale",
        payment_method: backendMethod,
        payer_kind: payerKind,
        customer_id,
        payer_user_id,
        payer_department_id,
        requester_user_id: priceMode === "internal" ? requesterUserId : undefined,
        // Explicit shop scope — required when bundle-only carts ship a
        // sentinel product_variant_id=0 that backend can't introspect.
        shop_id: user?.shopId ?? undefined,
        cash_received:
          backendMethod === "cash" && ctx.cashReceived !== undefined
            ? ctx.cashReceived
            : undefined,
        items: cart.map((item) => {
          const catalogPrice =
            priceMode === "internal" ? (item.internalPrice ?? item.price) : item.price;
          if (item.isBundle && item.bundleId != null) {
            return {
              // product_variant_id is unused by the backend for bundle items,
              // but the field is required by the schema — send 0 as sentinel.
              product_variant_id: 0,
              quantity: item.quantity,
              unit_price: catalogPrice,
              price_override: item.priceOverride ?? null,
              discount: getItemDiscountAmount(item),
              is_bundle: true,
              bundle_id: item.bundleId,
            };
          }
          return {
            product_variant_id: item.id,
            quantity: item.quantity,
            unit_price: catalogPrice,
            price_override: item.priceOverride ?? null,
            discount: getItemDiscountAmount(item),
          };
        }),
        discount: billDiscountAmount,
        notes: isDept
          ? `Dept: ${ctx.deptId ?? ""}${ctx.empCode ? ` · Emp: ${ctx.empCode}` : ""}`
          : undefined,
        edc_terminal_ref: ctx.edcRefs?.terminal_ref,
        edc_approval_code: ctx.edcRefs?.approval_code,
        edc_masked_card: ctx.edcRefs?.masked_card,
      };

      const receipt = await api.post<{ receipt_number: string; total: number }>(
        "/pos/checkout",
        payload,
      );

      // Compute remaining balance for wallet payments to show in success modal
      let remaining: number | undefined;
      if (isWallet && ctx.payer) {
        const before =
          ctx.payer.kind === "customer"
            ? (ctx.payer.student.wallet_balance ?? 0)
            : ctx.payer.user.wallet_balance;
        remaining = before - receipt.total;
      }

      setLastReceipt({
        receiptNumber: receipt.receipt_number,
        amount: receipt.total,
        remainingBalance: remaining,
        studentName: studentNameForReceipt,
        studentPhotoUrl: studentPhotoForReceipt,
        studentGrade: studentGradeForReceipt,
      });

      // Auto-print receipt — fires once per completed sale. Silent printing
      // requires Chromium launched with --kiosk-printing on the cashier station.
      // Skipped entirely when the per-station auto-print toggle is off.
      if (autoPrint) {
        try {
          printReceipt(
            { ...(receipt as unknown as ReceiptApi), cash_received: backendMethod === "cash" ? (ctx.cashReceived ?? null) : null },
            schoolInfo,
            user?.shopName,
            "en",
          );
        } catch (printErr) {
          console.warn("Auto-print failed:", printErr);
        }
      }

      // Refresh stock locally (skip bundles — they use a sentinel stock value)
      setAllProducts((prev) =>
        prev.map((p) => {
          if (p.isBundle) return p;
          const inCart = cart.find((c) => c.id === p.id);
          return inCart ? { ...p, stock: p.stock - inCart.quantity } : p;
        }),
      );

      // Reset cart + close all payment modals + open success
      setCart([]);
      setLastAddedId(null);
      setRequesterUserId(null);
      setBillDiscountValue("");
      setBillDiscountMode("amount");
      setPreSelectedMember(null);
      setMethodPickerOpen(false);
      setWalletOpen(false);
      setCashOpen(false);
      setQrOpen(false);
      setDeptOpen(false);
      setEdcOpen(false);
      setSuccessOpen(true);
    } catch (err: any) {
      if (err instanceof ApiError && err.code?.startsWith("EXCEEDS_NEGATIVE_CREDIT_LIMIT")) {
        setWalletLimitError(err.detail);
      } else {
        const detail = err instanceof ApiError ? err.detail : err?.message ?? "";
        toast.error(t("checkout.failed", "Checkout failed"), {
          description: detail || t("checkout.failedHint", "Please try again or check your network."),
        });
      }
    } finally {
      setConfirming(false);
    }
  };

  // ── Open payment picker ─────────────────────────────────────────────────
  const handleOpenPayment = async () => {
    if (cart.length === 0) {
      toast.error(t("store.pleaseAddProducts"));
      return;
    }

    // If member is pre-selected, charge directly via wallet
    if (preSelectedMember) {
      setConfirming(true);
      try {
        const currentBalance = Number(preSelectedMember.wallet_balance ?? 0);
        await doCheckout("wallet", {
          payer:
            preSelectedMember.user_id != null
              ? {
                  kind: "user",
                  user: {
                    user_id: preSelectedMember.user_id,
                    username: preSelectedMember.customer_code ?? "",
                    full_name: preSelectedMember.name,
                    role: preSelectedMember.customer_kind ?? "parent",
                    photo_url: preSelectedMember.photo_url ?? null,
                    wallet_id: preSelectedMember.wallet_id ?? 0,
                    wallet_balance: preSelectedMember.wallet_balance ?? 0,
                    is_active: true,
                  },
                }
              : { kind: "customer", student: preSelectedMember },
        });
        setPreSelectedMember(null);
      } catch (e) {
        // Error already handled in doCheckout
      } finally {
        setConfirming(false);
      }
      return;
    }

    setMethodPickerOpen(true);
  };

  const handlePickMethod = (method: CanteenPaymentMethod) => {
    setMethodPickerOpen(false);
    if (method === "wallet") setWalletOpen(true);
    else if (method === "cash") setCashOpen(true);
    else if (method === "qr") setQrOpen(true);
    else if (method === "department") setDeptOpen(true);
    else if (method === "edc") setEdcOpen(true);
  };

  const handleBackToPicker = () => {
    setWalletOpen(false);
    setCashOpen(false);
    setQrOpen(false);
    setDeptOpen(false);
    setEdcOpen(false);
    setMethodPickerOpen(true);
  };

  // ── Per-method confirm shortcuts ────────────────────────────────────────
  const handleConfirmWallet = (payer: WalletPayer) => doCheckout("wallet", { payer });
  const handleConfirmCash = (cashReceived: number) =>
    doCheckout("cash", { cashReceived });
  const handleConfirmQr = () => doCheckout("qr");
  const handleConfirmDept = (deptId: number, empCode: string | null) =>
    doCheckout("department", { deptId, empCode });
  const handleConfirmEdc = (refs: { approval_code: string; terminal_ref?: string; masked_card?: string }) =>
    doCheckout("edc", { edcRefs: refs });

  // ── Available payment methods ───────────────────────────────────────────
  const availableMethods: CanteenPaymentMethod[] = ["wallet", "cash", "qr", "edc"];

  // ── Cart panel renderer (reused for desktop + mobile sheet) ─────────────
  // NOTE: this is a plain render-fn, NOT a React component. Defining a
  // component inside the parent re-creates its identity each render, which
  // causes React to unmount/remount the entire subtree (and any children's
  // local state, focus, etc.). A render fn returning JSX side-steps that.
  const renderCartPanel = (asSheet: boolean) => (
    <div className={asSheet ? "canteen-cart-sheet" : "canteen-cart-panel"}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div>
          <h2 className="text-base font-bold leading-none">{t("store.order", "Order")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("store.itemCount", { count: itemCount })}
          </p>
        </div>
        {cart.length > 0 && (
          <button
            type="button"
            onClick={clearCart}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 transition"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("store.clearAll", "Clear all")}
          </button>
        )}
      </div>

      {/* Selected Member */}
      {preSelectedMember && (
        <div className="mx-3 mt-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-3">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-amber-100 ring-2 ring-amber-300">
              {preSelectedMember.photo_url ? (
                <img
                  src={preSelectedMember.photo_url}
                  alt={preSelectedMember.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-amber-400">
                  <UserCircle2 className="h-8 w-8" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm truncate">{preSelectedMember.name}</div>
              <div className="text-xs text-muted-foreground">
                {preSelectedMember.student_code ?? preSelectedMember.customer_code}
                {preSelectedMember.grade && ` · Grade ${preSelectedMember.grade}`}
              </div>
              <div className="text-sm font-bold tabular-nums text-emerald-600">
                ฿{(preSelectedMember.wallet_balance ?? 0).toFixed(2)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPreSelectedMember(null)}
              className="shrink-0 rounded-full p-1.5 hover:bg-amber-100 text-muted-foreground hover:text-foreground"
              aria-label={t("common.cancel")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Cart items */}
      <div className="flex-1 overflow-y-auto">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground py-12">
            <ScanBarcode className="h-16 w-16 opacity-15" />
            <p className="text-sm">{t("store.emptyCart")}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {cart.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "px-4 py-3 transition-colors",
                  item.id === lastAddedId && "bg-primary/5",
                )}
              >
                <div className="flex items-start gap-2.5">
                  {item.photoUrl ? (
                    <img
                      src={item.photoUrl}
                      alt=""
                      className="h-10 w-10 rounded object-cover border shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded bg-muted border flex items-center justify-center shrink-0">
                      <Package className="h-4 w-4 text-muted-foreground/60" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm leading-snug truncate">{item.name}</p>
                      {item.quantity < 0 && (
                        <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                          {t("store.refundBadge", "Refund")}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono">{item.barcode}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex items-center gap-1">
                        <IconButton
                          tooltip={t("store.tooltip.qtyDec")}
                          variant="outline"
                          className="h-6 w-6"
                          onClick={() => updateQuantity(item.id, -1)}
                        >
                          <Minus className="h-3 w-3" />
                        </IconButton>
                        <span className={cn(
                          "w-7 text-center text-sm font-bold tabular-nums",
                          item.quantity < 0 && "text-rose-600",
                        )}>
                          {item.quantity}
                        </span>
                        <IconButton
                          tooltip={t("store.tooltip.qtyInc")}
                          variant="outline"
                          className="h-6 w-6"
                          onClick={() => updateQuantity(item.id, 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </IconButton>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const current = getPriceForItem(item);
                          const input = window.prompt(
                            t("store.priceOverridePrompt"),
                            String(current),
                          );
                          if (input === null) return;
                          const trimmed = input.trim();
                          if (trimmed === "") {
                            setCart((prev) =>
                              prev.map((c) => (c.id === item.id ? { ...c, priceOverride: null } : c)),
                            );
                            return;
                          }
                          const parsed = parseFloat(trimmed);
                          if (!isNaN(parsed) && parsed >= 0) {
                            setCart((prev) =>
                              prev.map((c) => (c.id === item.id ? { ...c, priceOverride: parsed } : c)),
                            );
                          }
                        }}
                        className="text-xs tabular-nums hover:underline"
                      >
                        ฿{getPriceForItem(item).toLocaleString()}
                        {item.priceOverride != null && (
                          <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-900">
                            {t("store.priceEdited", "แก้ไข")}
                          </span>
                        )}
                      </button>
                    </div>
                    {/* Line discount row */}
                    <div className="flex items-center justify-between mt-1.5 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">
                          {t("store.tableDiscount", "ส่วนลด")}:
                        </span>
                        {(item.discountValue ?? 0) > 0 && (
                          <span className="text-xs font-semibold text-amber-700">
                            −{item.discountValue}{item.discountMode === "percent" ? "%" : "฿"}
                          </span>
                        )}
                        <DiscountShortcutPopover
                          itemId={item.id}
                          currentValue={item.discountValue}
                          currentMode={item.discountMode}
                          onUpdate={(id, value, mode) =>
                            setCart((prev) =>
                              prev.map((c) =>
                                c.id === id
                                  ? { ...c, discountValue: value ?? 0, discountMode: mode }
                                  : c,
                              ),
                            )
                          }
                        />
                        {(item.discountValue ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setCart((prev) =>
                                prev.map((c) => c.id === item.id ? { ...c, discountValue: 0 } : c),
                              )
                            }
                            className="h-5 px-1 text-[10px] text-destructive rounded hover:bg-destructive/10"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <span className="font-bold text-primary tabular-nums">
                        ฿{getItemLineTotal(item).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <IconButton
                    tooltip={t("store.tooltip.removeItem")}
                    className="h-6 w-6 shrink-0"
                    onClick={() => removeFromCart(item.id)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer — always shown (Charge button disabled when cart empty) */}
      <div className="border-t border-border/60 px-5 py-5 space-y-3">
          {/* Subtotal */}
          <div className="flex justify-between items-baseline text-base text-muted-foreground">
            <span>{t("store.subtotal", "ยอดรวม")}</span>
            <span className="tabular-nums font-semibold text-foreground">฿{subtotal.toLocaleString()}</span>
          </div>

          {/* Bill discount row (shown when active) */}
          {billDiscountAmount > 0 && (
            <div className="flex justify-between text-base text-destructive">
              <span>{t("store.billDiscount")}</span>
              <span className="tabular-nums font-semibold">-฿{billDiscountAmount.toLocaleString()}</span>
            </div>
          )}

          {/* Add Discount popover button */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={cart.length === 0}
                className={cn(
                  "w-full h-12 rounded-xl border text-base font-semibold transition",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  billDiscountAmount > 0
                    ? "border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-100"
                    : "border-amber-400 text-amber-600 hover:bg-amber-50",
                )}
              >
                {billDiscountAmount > 0
                  ? `${t("store.billDiscount")} · -฿${billDiscountAmount.toLocaleString()}`
                  : t("store.addDiscount", "Add Discount")}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3 space-y-3" side="top">
              <p className="text-xs font-semibold text-muted-foreground">{t("store.billDiscount")}</p>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={billDiscountValue}
                  onChange={(e) => setBillDiscountValue(e.target.value)}
                  className="h-9 text-right text-sm flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 font-bold shrink-0"
                  onClick={() => setBillDiscountMode((m) => (m === "percent" ? "amount" : "percent"))}
                >
                  {billDiscountMode === "percent" ? "%" : "฿"}
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {(billDiscountMode === "percent" ? [5, 10, 15, 20] : [10, 20, 50, 100]).map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setBillDiscountValue(String(q))}
                    className={cn(
                      "h-9 rounded-lg border text-xs font-semibold transition",
                      parseFloat(billDiscountValue) === q
                        ? "border-amber-500 bg-amber-500 text-white"
                        : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
                    )}
                  >
                    {billDiscountMode === "percent" ? `${q}%` : `฿${q}`}
                  </button>
                ))}
              </div>
              {billDiscountAmount > 0 && (
                <button
                  type="button"
                  onClick={() => setBillDiscountValue("")}
                  className="w-full h-8 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted transition"
                >
                  Clear
                </button>
              )}
            </PopoverContent>
          </Popover>

          {/* Total */}
          <div className="flex justify-between items-baseline pt-2">
            <span className="text-lg font-bold">{t("store.tableTotal")}</span>
            <span className="text-3xl font-extrabold text-primary tabular-nums">
              ฿{total.toLocaleString()}
            </span>
          </div>

          {/* Charge button */}
          <Button
            onClick={() => {
              if (asSheet) setCartSheetOpen(false);
              handleOpenPayment();
            }}
            disabled={cart.length === 0 || confirming}
            className="mt-2 w-full h-16 text-lg font-extrabold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-lg shadow-amber-400/40"
          >
            {confirming ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              `${t("store.charge", "Charge")} ฿${total.toLocaleString()}`
            )}
          </Button>
      </div>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="canteen-layout">
      {/* Main content (left): header + search + grid */}
      <div className="canteen-content">
        {/* Header */}
        <div className="page-header flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTopupOpen(true)}
              className="gap-1.5"
            >
              <Wallet className="h-4 w-4" />
              <span className="hidden sm:inline">{t("store.topup", "เติมเงิน")}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMemberSearchOpen(true)}
              className="gap-1.5"
            >
              <UserSearch className="h-4 w-4" />
              <span className="hidden sm:inline">{t("store.searchMember", "ค้นหาสมาชิก")}</span>
            </Button>
            {canManageOrder && user?.shopId && (
              reorderMode ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setReorderMode(false); setReorderDirty(false); }}
                    className="gap-1.5"
                  >
                    <X className="h-4 w-4" />
                    {t("common.cancel")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={saveReorder}
                    disabled={!reorderDirty || reorderSaving}
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Check className="h-4 w-4" />
                    {reorderSaving ? t("store.reorderSaving") : t("store.saveOrder")}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void enterReorderMode()}
                  className="gap-1.5"
                >
                  <ArrowUpDown className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("store.reorder.enter")}</span>
                </Button>
              )
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
          </div>
          {user?.shopName && (
            <Badge variant="outline" className="text-base font-bold px-4 py-1.5 shrink-0 border-2">
              {user.shopName}
            </Badge>
          )}
        </div>

        {/* Search with suggestion dropdown */}
        <div ref={dropdownRef} className="relative">
          <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-amber-500 pointer-events-none z-10" />
          <Input
            ref={searchInputRef}
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setDropdownOpen(e.target.value.trim().length > 0);
              setHighlightedIndex(0);
            }}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => searchTerm.trim() && setDropdownOpen(true)}
            placeholder={t("store.searchPlaceholder")}
            className="pl-9 font-mono text-sm h-11 text-amber-500 placeholder:text-amber-400/70"
            autoComplete="off"
          />

          {dropdownOpen && suggestions.length > 0 && (
            <div
              role="listbox"
              className="absolute top-full left-0 right-0 z-50 mt-1 overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
            >
              {suggestions.map((p, i) => (
                <div
                  key={p.id}
                  role="option"
                  aria-selected={i === highlightedIndex}
                  onMouseEnter={() => setHighlightedIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commitSuggestion(p);
                  }}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors",
                    i === highlightedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                >
                  {p.photoUrl ? (
                    <img
                      src={p.photoUrl}
                      alt=""
                      className="h-10 w-10 rounded-md object-cover border shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-md bg-muted border flex items-center justify-center shrink-0">
                      <Package className="h-5 w-5 text-muted-foreground/60" />
                    </div>
                  )}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-medium text-sm truncate">{p.name}</span>
                    <span className="text-xs text-muted-foreground font-mono">{p.barcode}</span>
                  </div>
                  <div className="text-right ml-2 shrink-0">
                    <p className="font-bold text-primary text-sm tabular-nums">
                      ฿{(priceMode === "internal"
                        ? p.internalPrice ?? p.price
                        : getPrice(p)
                      ).toLocaleString()}
                    </p>
                    <Badge variant="outline" className="text-xs">{p.category}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}

          {dropdownOpen && searchTerm.trim() && suggestions.length === 0 && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg border border-border bg-popover px-4 py-3 text-sm text-muted-foreground shadow-lg">
              {t("store.productNotFound")}
            </div>
          )}
        </div>


        {/* Panel selector — only shown for shop-scoped users with panels */}
        {user?.shopId && panels.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 shrink-0">
            <span className="text-xs font-semibold text-muted-foreground shrink-0">{t("store.priceLabel")}</span>
            <button
              type="button"
              onClick={() => setActivePanelId(null)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition",
                activePanelId === null
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background text-muted-foreground hover:border-muted-foreground",
              )}
            >
              {t("store.normalPrice")}
            </button>
            {panels.map((panel) => (
              <button
                key={panel.id}
                type="button"
                onClick={() => setActivePanelId(panel.id)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition",
                  activePanelId === panel.id
                    ? panel.color && panelColorClass[panel.color]
                      ? `border-2 ${panelColorClass[panel.color]} font-bold`
                      : "border-primary bg-primary text-primary-foreground"
                    : panel.color && panelColorClass[panel.color]
                    ? `border ${panelColorClass[panel.color]} opacity-70 hover:opacity-100`
                    : "border-input bg-background text-muted-foreground hover:border-muted-foreground",
                )}
              >
                {panel.name}
              </button>
            ))}
          </div>
        )}

        {/* Browse grid */}
        {allProducts.length > 0 && (() => {
          // In reorder mode: show regular products only (bundles excluded from reorder)
          const gridProducts = reorderMode
            ? allProducts.filter((p) => !p.isBundle && (!user?.shopId || p.subMerchantId === user.shopId))
            : activePanelId != null && panelIncluded[activePanelId]
              ? allProducts.filter((p) => panelIncluded[activePanelId].has(p.id))
              : allProducts;

          const cardContent = (p: Product, handleProps: React.HTMLAttributes<HTMLElement>) => {
            const displayPrice = priceMode === "internal"
              ? (p.internalPrice ?? p.price)
              : getPrice(p);
            const zeroStock = p.stock <= 0;
            const lowStock = p.stock > 0 && p.stock <= 3;
            return (
              <button
                type="button"
                onClick={reorderMode ? undefined : () => addToCart(p)}
                data-card-color={p.color ? "true" : undefined}
                className={cn(
                  "pos-product-tile group relative flex flex-col justify-between rounded-2xl border border-amber-200/60 p-3 text-left transition w-full h-[7.5rem] overflow-hidden",
                  !p.color && !reorderMode && "bg-card hover:-translate-y-0.5 hover:shadow-lg hover:shadow-amber-200/50 hover:border-amber-300",
                  reorderMode && "cursor-default select-none",
                )}
                style={
                  p.color
                    ? ({
                        "--card-color": p.color,
                        backgroundColor: p.color,
                      } as React.CSSProperties)
                    : undefined
                }
                {...(reorderMode ? handleProps : {})}
              >
                {/* Drag handle indicator */}
                {reorderMode && (
                  <div className="absolute top-1 left-1 z-10 rounded bg-background/80 p-0.5 shadow">
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                )}
                {/* Stock badge — top-right */}
                {!p.isBundle && (
                  <span className={cn(
                    "absolute right-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums shadow",
                    zeroStock ? "bg-amber-500 text-white" :
                    lowStock  ? "bg-orange-400 text-white" :
                                "bg-background/90 text-foreground",
                  )}>
                    {`${t("store.stockLabel")} ${p.stock}`}
                  </span>
                )}
                <div className={cn(
                  // Top margin pushes the name below the absolute Remaining
                  // badge so long two-line names don't overlap with it.
                  "line-clamp-2 text-sm font-bold leading-tight mt-5",
                  p.color ? "text-zinc-900" : "text-foreground",
                )}>
                  {activePanelId != null && panelShortNames[activePanelId]?.[p.id]
                    ? panelShortNames[activePanelId][p.id]
                    : p.name}
                </div>
                <div className="mt-auto pt-1 flex items-end justify-between">
                  <span className={cn(
                    "text-base font-extrabold tabular-nums",
                    p.color ? "text-zinc-900" : "text-primary",
                  )}>฿{displayPrice.toLocaleString()}</span>
                  <div className="flex items-center gap-1">
                    {p.isBundle && (
                      <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 border border-violet-300 shrink-0">
                        SET
                      </span>
                    )}
                    {!reorderMode && !p.isBundle && (
                      <Popover
                        open={colorEditId === p.id}
                        onOpenChange={(open) => {
                          if (open) { setColorEditId(p.id); setColorEditValue(p.color ?? "#4ade80"); }
                          else { setColorEditId(null); }
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className={cn(
                              "rounded p-0.5 transition",
                              p.color ? "hover:bg-black/10" : "hover:bg-muted",
                            )}
                            title={t("store.cardColorTitle")}
                          >
                            <Palette
                              className={cn(
                                "h-3.5 w-3.5",
                                p.color ? "text-zinc-900" : "text-muted-foreground",
                              )}
                            />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-3 space-y-3" onClick={(e) => e.stopPropagation()} side="top" align="end">
                          <p className="text-xs font-semibold">{t("store.cardColorLabel")}</p>
                          <div className="flex items-center gap-2">
                            <input type="color" value={colorEditValue} onChange={(e) => setColorEditValue(e.target.value)} className="h-8 w-10 cursor-pointer rounded border p-0.5 shrink-0" />
                            <input type="text" value={colorEditValue} onChange={(e) => setColorEditValue(e.target.value)} className="w-full rounded border border-border px-2 py-1 text-xs font-mono bg-background" placeholder="#4ade80" />
                          </div>
                          <div className="flex gap-1.5 flex-wrap">
                            {["#f87171","#fb923c","#fbbf24","#4ade80","#34d399","#60a5fa","#a78bfa","#f472b6","#94a3b8"].map((c) => (
                              <button key={c} type="button" onClick={() => setColorEditValue(c)}
                                className={cn("h-6 w-6 rounded-full border-2 transition", colorEditValue === c ? "border-foreground scale-110" : "border-transparent hover:scale-105")}
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => saveProductColor(p, null)} disabled={colorSaving} className="flex-1 rounded-md border border-border bg-background py-1.5 text-[11px] text-muted-foreground hover:bg-muted transition">{t("store.clearColor")}</button>
                            <button type="button" onClick={() => saveProductColor(p, colorEditValue)} disabled={colorSaving} className="flex-1 rounded-md bg-primary py-1.5 text-[11px] text-primary-foreground font-semibold hover:bg-primary/90 transition">{colorSaving ? "…" : t("store.saveColor")}</button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                    {!p.isBundle && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 max-w-[5rem] truncate">{p.category}</Badge>
                    )}
                  </div>
                </div>
              </button>
            );
          };

          return (
            <div className="flex-1 flex flex-col min-h-0 rounded-xl border border-border/60 bg-card/40 p-3 gap-3">
              {reorderMode && (
                <p className="text-xs text-muted-foreground shrink-0">
                  <GripVertical className="inline h-3 w-3 mr-1" />
                  {t("store.reorderHint")}
                </p>
              )}
              <div className="flex-1 overflow-y-auto">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={gridProducts.map((p) => String(p.id))} strategy={rectSortingStrategy}>
                    <div className="canteen-grid">
                      {gridProducts.map((p) => (
                        <SortableCard key={p.id} id={p.id} reorderMode={reorderMode}>
                          {(handleProps, _isDragging) => cardContent(p, handleProps)}
                        </SortableCard>
                      ))}
                      {gridProducts.length === 0 && (
                        <div className="col-span-full py-6 text-center text-sm text-muted-foreground">
                          {t("store.noItemsInCategory", "ไม่มีสินค้าในหมวดหมู่นี้")}
                        </div>
                      )}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Desktop cart panel (≥lg) */}
      {renderCartPanel(false)}

      {/* Mobile floating cart trigger */}
      {cart.length > 0 && (
        <Button
          onClick={() => setCartSheetOpen(true)}
          className="lg:hidden fixed bottom-4 right-4 z-40 h-14 px-5 rounded-full text-base font-bold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-lg shadow-amber-400/50"
        >
          <ShoppingCart className="h-5 w-5 mr-2" />
          <span className="tabular-nums">฿{total.toFixed(0)} · {itemCount}</span>
        </Button>
      )}

      {/* Mobile cart sheet */}
      <Sheet open={cartSheetOpen} onOpenChange={setCartSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col lg:hidden">
          {renderCartPanel(true)}
        </SheetContent>
      </Sheet>

      {/* Payment method picker */}
      <PaymentMethodPicker
        open={methodPickerOpen}
        onOpenChange={setMethodPickerOpen}
        total={total}
        methods={availableMethods}
        walletLabel={t("store.studentCard", "บัตรนักเรียน")}
        onSelect={handlePickMethod}
      />

      {/* Wallet (student / parent / staff card) */}
      <RfidPaymentModal
        open={walletOpen}
        onOpenChange={setWalletOpen}
        total={total}
        onBack={handleBackToPicker}
        onConfirm={handleConfirmWallet}
        confirming={confirming}
      />

      {/* Cash */}
      <CashPaymentModal
        open={cashOpen}
        onOpenChange={setCashOpen}
        total={total}
        onBack={handleBackToPicker}
        onConfirm={handleConfirmCash}
        confirming={confirming}
      />

      {/* QR */}
      <QrPaymentModal
        open={qrOpen}
        onOpenChange={setQrOpen}
        total={total}
        onBack={handleBackToPicker}
        onConfirm={handleConfirmQr}
        confirming={confirming}
      />

      {/* Department */}
      <DepartmentPaymentModal
        open={deptOpen}
        onOpenChange={setDeptOpen}
        total={total}
        departments={departmentOptions}
        onBack={handleBackToPicker}
        onConfirm={handleConfirmDept}
        confirming={confirming}
      />

      {/* EDC */}
      <EdcPaymentModal
        open={edcOpen}
        onOpenChange={setEdcOpen}
        total={total}
        onBack={handleBackToPicker}
        onConfirm={handleConfirmEdc}
        confirming={confirming}
      />

      {/* Receipt success */}
      <ReceiptSuccessModal
        open={successOpen}
        onClose={() => setSuccessOpen(false)}
        receiptNumber={lastReceipt?.receiptNumber ?? ""}
        amount={lastReceipt?.amount ?? 0}
        remainingBalance={lastReceipt?.remainingBalance ?? null}
        studentName={lastReceipt?.studentName ?? null}
        studentPhotoUrl={lastReceipt?.studentPhotoUrl ?? null}
        studentGrade={lastReceipt?.studentGrade ?? null}
      />

      {/* Member search */}
      <MemberSearchModal
        open={memberSearchOpen}
        onOpenChange={setMemberSearchOpen}
        onSelect={(member) => {
          setPreSelectedMember(member);
          setMemberSearchOpen(false);
        }}
      />

      {/* Cashier top-up */}
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
            <DialogTitle>{t("store.setPrice")}</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              {specialItemTarget?.name} — {t("store.enterSellPrice")}
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
                if (e.key === "Enter" && specialItemTarget) {
                  const parsed = parseFloat(specialItemPrice);
                  if (!isNaN(parsed) && parsed >= 0) {
                    setCart((prev) => [
                      ...prev,
                      { ...specialItemTarget, quantity: 1, priceOverride: parsed },
                    ]);
                    setLastAddedId(specialItemTarget.id);
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
                if (!specialItemTarget) return;
                const parsed = parseFloat(specialItemPrice);
                if (!isNaN(parsed) && parsed >= 0) {
                  setCart((prev) => [
                    ...prev,
                    { ...specialItemTarget, quantity: 1, priceOverride: parsed },
                  ]);
                  setLastAddedId(specialItemTarget.id);
                  setSpecialItemTarget(null);
                }
              }}
              disabled={isNaN(parseFloat(specialItemPrice)) || parseFloat(specialItemPrice) < 0}
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-white"
            >
              {t("store.addToCart")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wallet limit exceeded — prominent AlertDialog */}
      <AlertDialog open={!!walletLimitError} onOpenChange={(o) => { if (!o) setWalletLimitError(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600">{t("store.insufficientBalance")}</AlertDialogTitle>
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
              aria-label="Close"
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
                <div className="text-xl font-bold text-amber-900 leading-tight">{rfidNotif.title}</div>
                {rfidNotif.sub && (
                  <div className="text-2xl font-extrabold text-amber-600 mt-1 tabular-nums">{rfidNotif.sub}</div>
                )}
              </>
            ) : (
              <>
                <div className="flex justify-center mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                  </svg>
                </div>
                <div className="text-base font-semibold text-red-700">{rfidNotif.title}</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Store;
