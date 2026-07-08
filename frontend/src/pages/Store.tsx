import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IconButton } from "@/components/IconButton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import { printReceipt, type ReceiptApi } from "@/lib/printReceipt";
import { resolveAvatarUrl, getFallbackAvatar } from "@/lib/avatarFallback";
import {
    Plus,
    Minus,
    Trash2,
    ScanBarcode,
    ShoppingCart,
    Package,
    UserSearch,
    Wallet,
    X,
    ArrowUpDown,
    Check,
    Printer,
    Loader2,
    MessageSquare,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useDisplayBroadcast } from "@/hooks/useDisplayBroadcast";
import type { SpendingLimitData } from "@/hooks/useDisplayBroadcast";
import { useProductReorder } from "@/hooks/useProductReorder";
import { useStoreRfidScanner } from "@/hooks/useStoreRfidScanner";

function storeSpendingLimit(s: { daily_limit_store?: number | null; spent_today_store?: number | null } | null): SpendingLimitData | null {
    if (!s || s.daily_limit_store == null) return null;
    const spent = s.spent_today_store ?? 0;
    return { daily_limit: s.daily_limit_store, spent_today: spent, remaining: Math.max(0, s.daily_limit_store - spent), group_name: "Daily Store Limit" };
}
import {
    afterPaymentPayer,
    cartToDisplayItems,
    payerForCustomer,
    payerForDepartment,
    payerForUser,
    paymentMethodForDisplay,
} from "@/lib/customerDisplay";
import { autoOpenCustomerDisplayWindow } from "@/lib/customerDisplayWindow";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PaymentMethodPicker, type CanteenPaymentMethod } from "./canteen/PaymentMethodPicker";
import { CashPaymentModal } from "./canteen/CashPaymentModal";
import { QrPaymentModal } from "./canteen/QrPaymentModal";
import { RfidPaymentModal, type WalletPayer, type StudentLookupResult } from "./canteen/RfidPaymentModal";
import { ReceiptSuccessModal } from "./canteen/ReceiptSuccessModal";
import { DepartmentPaymentModal, type DepartmentOption } from "./store/DepartmentPaymentModal";
import { EdcPaymentModal } from "./store/EdcPaymentModal";
import { MemberSearchModal } from "./canteen/MemberSearchModal";
import { UpToDateSaleButton } from "@/components/canteen/UpToDateSaleButton";
import { CashierTopupModal } from "@/components/CashierTopupModal";
import { Switch } from "@/components/ui/switch";
import { useAutoPrint } from "@/hooks/useAutoPrint";
import { DiscountShortcutPopover } from "./store/DiscountShortcutPopover";
import { ProductReorderGrid } from "./store/ProductReorderGrid";
import { ProductSearchDropdown } from "./store/ProductSearchDropdown";
import { BillDiscountPopover } from "./store/BillDiscountPopover";
import { ReceiptNoteModal } from "./store/ReceiptNoteModal";
import { SpecialItemPriceDialog } from "./store/SpecialItemPriceDialog";
import { panelColorClass } from "./store/storeTypes";
import type { Product, DiscountMode, CartItem, LastReceipt } from "./store/storeTypes";

const Store = () => {
    const { t } = useTranslation();
    const { user, hasRole } = useAuth();
    const [autoPrint, setAutoPrint] = useAutoPrint(`store:${user?.shopId ?? "default"}`);
    const schoolInfo = useSchoolInfo();

    // Pop the customer display once when entering the POS, on desktop only.
    // Multi-role users (manager+parent, etc.) reach the store via the Hub
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

    // ── Per-shop receipt overrides ──────────────────────────────────────────
    const [shopReceipt, setShopReceipt] = useState<{
        receiptHeader: string | null;
        receiptFooter: string | null;
    } | null>(null);

    useEffect(() => {
        if (!user?.shopId) return;
        api.get<{ receipt_header: string | null; receipt_footer: string | null }>(`/shops/${user.shopId}`)
            .then((s) => setShopReceipt({ receiptHeader: s.receipt_header, receiptFooter: s.receipt_footer }))
            .catch(() => { });
    }, [user?.shopId]);

    // ── Products + shop metadata ────────────────────────────────────────────
    const [allProducts, setAllProducts] = useState<Product[]>([]);

    const [shopsMeta, setShopsMeta] = useState<Array<{ id: string; allow_department_charge: boolean; products_order_version?: number }>>([]);

    // ── Price panels ────────────────────────────────────────────────────────
    const [panels, setPanels] = useState<{ id: number; name: string; color: string | null }[]>([]);
    const [activePanelId, setActivePanelId] = useState<number | null>(null);
    // panelPrices: panelId -> productId -> price
    const [panelPrices, setPanelPrices] = useState<Record<number, Record<number, number>>>({});
    // panelShortNames: panelId -> productId -> short_name
    const [panelShortNames, setPanelShortNames] = useState<Record<number, Record<number, string>>>({});
    // panelIncluded: panelId -> Set of included product ids
    const [panelIncluded, setPanelIncluded] = useState<Record<number, Set<number>>>({});

    const {
        reorderMode,
        reorderDirty,
        reorderSaving,
        reorderItems,
        canManageOrder,
        sensors,
        collisionDetection,
        handleDragEnd,
        enterReorderMode,
        cancelReorderMode,
        saveReorder,
        setSortVersions,
    } = useProductReorder({
        shopId: user?.shopId,
        role: user?.role,
        allProducts,
        setAllProducts,
        activePanelId,
        panelIncluded,
    });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const result: Product[] = [];
            let shopsList: Array<{ id: string; allow_department_charge: boolean; products_order_version?: number }> = [];
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
                            price: Number(p.external_price ?? 0),
                            internalPrice: p.internal_price != null ? Number(p.internal_price) : undefined,
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
                            price: Number(b.external_price ?? 0),
                            internalPrice: Number(b.internal_price ?? b.external_price ?? 0),
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
                const panelList = await api.get<{ id: number; name: string; color: string | null }[]>(`/shops/${user.shopId}/price-panels`);
                if (cancelled) return;
                setPanels(panelList);
                // Fetch items for each panel
                const priceMap: Record<number, Record<number, number>> = {};
                const snameMap: Record<number, Record<number, string>> = {};
                const includedMap: Record<number, Set<number>> = {};
                await Promise.all(
                    panelList.map(async (panel) => {
                        try {
                            const items = await api.get<Array<{ product_id: number; panel_price: number | null; short_name: string | null; included: boolean; is_bundle?: boolean }>>(
                                `/shops/${user.shopId}/price-panels/${panel.id}/items`,
                            );
                            const productMap: Record<number, number> = {};
                            const snMap: Record<number, string> = {};
                            const includedSet = new Set<number>();
                            items.forEach((item) => {
                                // Bundles live in a negative id space in `allProducts`
                                // (see id: -(b.id) above) so their panel rows must be
                                // mirrored with the same negation, otherwise the POS
                                // filter and the panel-price lookup both miss them.
                                const key = item.is_bundle ? -item.product_id : item.product_id;
                                if (item.panel_price != null) productMap[key] = item.panel_price;
                                if (item.short_name) snMap[key] = item.short_name;
                                if (item.included !== false) includedSet.add(key);
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

    // ── Cart ────────────────────────────────────────────────────────────────
    const [cart, setCart] = useState<CartItem[]>([]);
    const [lastAddedId, setLastAddedId] = useState<number | null>(null);

    // ── Browse + search ─────────────────────────────────────────────────────
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

    // ── Receipt note (optional cashier memo, saved to receipt.notes) ────────
    const [receiptNote, setReceiptNote] = useState<string>("");
    const [noteModalOpen, setNoteModalOpen] = useState(false);

    // ── Customer display broadcast (second-monitor) ─────────────────────────
    const display = useDisplayBroadcast();

    // Reset the customer-facing window to the standby rotation whenever the
    // cashier enters this POS page. Without this, a stale "review" / "success"
    // state from a previous session can stick around in the popup and hide the
    // image rotation until the cashier starts a new checkout.
    useEffect(() => {
        display.standby();
    }, [display]);

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
    // Increment after each successful checkout to refresh the SpendingLimitChip
    const [chipRefreshKey, setChipRefreshKey] = useState(0);

    // Special item (price=0) — cashier must enter price before adding
    const [specialItemTarget, setSpecialItemTarget] = useState<Product | null>(null);

    // ── Cart actions ────────────────────────────────────────────────────────
    const addToCart = useCallback(
        (product: Product) => {
            // Special items (price=0) must have a cashier-entered price first.
            // Bundles always have a real price so we skip this check for them.
            if (product.price === 0 && !product.isBundle) {
                setSpecialItemTarget(product);
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
                return [{ ...product, quantity: 1, priceOverride: panelPrice }, ...prev];
            });
            setLastAddedId(product.id);
        },
        [activePanelId, panelPrices],
    );

    // ── Passive RFID/barcode listener (page-level, no input focused) ────────
    const rfidScanner = useStoreRfidScanner({
        products: allProducts,
        onProductMatch: addToCart,
        onMemberFound: setPreSelectedMember,
    });

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

    // Cart snapshot for the customer-display second monitor. Computed every
    // render so payer-card / order-review screens stay in sync as the
    // cashier tweaks discounts / overrides inside the payment modal.
    const buildDisplayItems = () =>
        cartToDisplayItems(
            cart.map((item) => ({
                name:
                    activePanelId != null && panelShortNames[activePanelId]?.[item.id]
                        ? panelShortNames[activePanelId][item.id]
                        : item.name,
                quantity: item.quantity,
                unitPrice: getPriceForItem(item),
                discount: getItemDiscountAmount(item),
            })),
        );

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

    // ── Live-broadcast cart to the customer display ─────────────────────────────
    // Mirrors the Canteen behaviour: as the cashier builds the cart or picks a
    // member, the second screen previews the order before any payment modal opens.
    const paymentModalOpen =
        methodPickerOpen || walletOpen || cashOpen || qrOpen || edcOpen || deptOpen;
    useEffect(() => {
        if (paymentModalOpen) return;
        if (cart.length === 0 && !preSelectedMember) {
            // Delay standby so the success/failed screen (TERMINAL_DWELL_MS=5000ms) can finish
            const timer = window.setTimeout(() => display.standby(), 5500);
            return () => window.clearTimeout(timer);
        }
        display.review({
            items: buildDisplayItems(),
            total,
            payer: preSelectedMember
                ? payerForCustomer(
                    { ...preSelectedMember, spendingLimit: storeSpendingLimit(preSelectedMember) },
                    total,
                )
                : null,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cart, total, preSelectedMember, paymentModalOpen]);

    const updateQuantity = (id: number, change: number) => {
        setCart((prev) =>
            prev
                .map((item) => {
                    if (item.id !== id) return item;
                    const next = item.quantity + change;
                    // Skip zero in both directions:
                    //   1 → press minus → -1  (positive sale becomes a return/refund line)
                    //  -1 → press plus  →  1  (cancel the refund, back to normal sale)
                    // Pressing minus on qty=1 no longer removes the item — use the trash
                    // button to remove. This lets cashiers do refund-via-POS by going negative.
                    if (next === 0) return { ...item, quantity: change > 0 ? 1 : -1 };
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
        setReceiptNote("");
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
        // Tell the customer display the payment is going through. Payer info
        // resolved best-effort so the screen can show the balance preview.
        const displayMethod = paymentMethodForDisplay(method);
        const displayPayer =
            method === "wallet" && ctx.payer
                ? ctx.payer.kind === "customer"
                    ? payerForCustomer({ ...ctx.payer.student, spendingLimit: storeSpendingLimit(ctx.payer.student) }, total)
                    : ctx.payer.kind === "department"
                        ? payerForDepartment(ctx.payer.department, total)
                        : payerForUser({ ...ctx.payer.user, spendingLimit: null }, total)
                : method === "department" && ctx.deptId
                    ? (() => {
                        const d = departmentOptions.find((x) => x.id === ctx.deptId);
                        return d ? payerForDepartment(d, total) : null;
                    })()
                    : null;
        display.processing({
            items: buildDisplayItems(),
            total,
            payer: displayPayer,
            method: displayMethod,
        });
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
                } else if (ctx.payer.kind === "department") {
                    // Department account tapped via RFID — treat as department charge
                    backendMethod = "department";
                    payerKind = "department";
                    payer_department_id = ctx.payer.department.id;
                    studentNameForReceipt = ctx.payer.department.department_name;
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
                    backendMethod === "cash" && ctx.cashReceived !== undefined && total > 0
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
                notes: (() => {
                    const parts: string[] = [];
                    if (isDept) parts.push(`Dept: ${ctx.deptId ?? ""}${ctx.empCode ? ` · Emp: ${ctx.empCode}` : ""}`);
                    if (receiptNote.trim()) parts.push(receiptNote.trim());
                    return parts.length > 0 ? parts.join(" | ") : undefined;
                })(),
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
                        : ctx.payer.kind === "user"
                            ? ctx.payer.user.wallet_balance
                            : (ctx.payer.department.wallet_balance ?? 0);
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
                        {
                            ...(receipt as unknown as ReceiptApi),
                            cash_received: backendMethod === "cash" ? (ctx.cashReceived ?? null) : null,
                            notes: (() => {
                                const parts: string[] = [];
                                if (isDept) parts.push(`Dept: ${ctx.deptId ?? ""}${ctx.empCode ? ` · Emp: ${ctx.empCode}` : ""}`);
                                if (receiptNote.trim()) parts.push(receiptNote.trim());
                                return parts.length > 0 ? parts.join(" | ") : null;
                            })(),
                        },
                        schoolInfo,
                        user?.shopName,
                        // School is international — receipt is always English on paper,
                        // regardless of the cashier's UI language.
                        "en",
                        shopReceipt ?? undefined,
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
            setReceiptNote("");
            setPreSelectedMember(null);
            setMethodPickerOpen(false);
            setWalletOpen(false);
            setCashOpen(false);
            setQrOpen(false);
            setDeptOpen(false);
            setEdcOpen(false);
            setSuccessOpen(true);
            setChipRefreshKey((k) => k + 1);

            // Customer display: payment landed. The display window auto-returns
            // to Standby 5 s after this success message.
            display.success({
                total: receipt.total,
                payer: ["wallet"].includes(method) ? afterPaymentPayer(displayPayer, receipt.total, "store") : displayPayer,
                method: displayMethod,
                receiptNumber: receipt.receipt_number,
            });
        } catch (err: any) {
            if (err instanceof ApiError && err.code?.startsWith("EXCEEDS_NEGATIVE_CREDIT_LIMIT")) {
                setWalletLimitError(err.detail);
            } else {
                const detail = err instanceof ApiError ? err.detail : err?.message ?? "";
                toast.error(t("checkout.failed", "Checkout failed"), {
                    description: detail || t("checkout.failedHint", "Please try again or check your network."),
                });
            }
            // Customer display: surface the failure with the same message the
            // cashier sees, so the customer can react accordingly.
            const reason =
                err instanceof ApiError
                    ? err.detail
                    : err?.message ?? "Payment could not be completed.";
            display.failed({ reason: String(reason), method: displayMethod, payer: displayPayer });
            // QR modal was closed immediately on confirm — reopen so cashier can retry
            if (method === "qr") setQrOpen(true);
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

        // Customer display: surface "Your Order" the moment the cashier moves
        // to the payment step (whether the picker opens or a fast-path wallet
        // charge runs immediately for a pre-selected member).
        display.review({
            items: buildDisplayItems(),
            total,
            payer:
                preSelectedMember != null
                    ? payerForCustomer({ ...preSelectedMember, spendingLimit: storeSpendingLimit(preSelectedMember) }, total)
                    : null,
        });

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
        else if (method === "qr") {
            setQrOpen(true);
            // QR is special: the customer needs to see the code before confirming.
            // Push it to the second monitor the moment the QR modal opens.
            display.qr({
                items: buildDisplayItems(),
                total,
                // No real PromptPay integration yet — encode the amount so the
                // customer-display QR renders something deterministic.
                qrPayload: `PROMPTPAY|AMOUNT|${total.toFixed(2)}`,
                expiresAt: null,
            });
        }
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
    // QR PromptPay now lives entirely inside QrPaymentModal (BAY intent +
    // polling + auto-receipt via webhook). handleConfirmQr no longer needed.
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
                        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full bg-amber-100 ring-2 ring-amber-300">
                            <img
                                src={resolveAvatarUrl(preSelectedMember.photo_url, preSelectedMember.name || String(preSelectedMember.id))}
                                alt={preSelectedMember.name}
                                className="h-full w-full object-cover"
                                onError={(e) => { e.currentTarget.src = getFallbackAvatar(preSelectedMember.name || String(preSelectedMember.id)); }}
                            />
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
                            className="shrink-0 rounded-full p-1.5 hover:bg-red-100 text-red-500 hover:text-red-600"
                            aria-label={t("common.cancel")}
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    {/* Daily Spending Limit panel */}
                    {preSelectedMember.customer_kind !== "department" && preSelectedMember.user_id == null && (() => {
                        const fmt = (n: number) => "฿" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
                        const rows: { label: string; limit: number; spent: number }[] = [];
                        if (preSelectedMember.daily_limit_canteen != null)
                            rows.push({ label: "Canteen", limit: Number(preSelectedMember.daily_limit_canteen), spent: Number(preSelectedMember.spent_today_canteen ?? 0) });
                        if (preSelectedMember.daily_limit_store != null)
                            rows.push({ label: "Store", limit: Number(preSelectedMember.daily_limit_store), spent: Number(preSelectedMember.spent_today_store ?? 0) });
                        if (rows.length === 0) return null;
                        return (
                            <div className="mt-2.5 rounded-lg border border-amber-200 bg-white/60 px-3 py-2 space-y-2">
                                <div className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                                    Daily Spending Limit
                                </div>
                                {rows.map(({ label, limit, spent }) => {
                                    const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
                                    const over = spent >= limit;
                                    const warn = pct >= 80;
                                    const valueColor = over ? "text-red-600" : warn ? "text-amber-600" : "text-amber-500";
                                    const barColor = over ? "bg-red-500" : "bg-amber-500";
                                    return (
                                        <div key={label} className="space-y-1">
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="text-foreground font-medium">{label}</span>
                                                <span className={cn("font-bold tabular-nums", valueColor)}>
                                                    {fmt(spent)}{" "}
                                                    <span className="font-normal text-muted-foreground">/ {fmt(limit)}</span>
                                                </span>
                                            </div>
                                            <div className="w-full h-1.5 rounded-full bg-amber-100 overflow-hidden">
                                                <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}
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

                {/* Note + Add Discount — side by side */}
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => setNoteModalOpen(true)}
                        className={cn(
                            "flex-1 h-9 rounded-xl border text-sm font-semibold transition flex items-center justify-center gap-1.5 relative",
                            receiptNote ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100" : "border-border hover:bg-muted",
                        )}
                    >
                        <MessageSquare className="h-4 w-4" />
                        {t("store.receiptNoteLabel", "Note")}
                        {receiptNote && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-blue-500" />}
                    </button>

                    <BillDiscountPopover
                        disabled={cart.length === 0}
                        value={billDiscountValue}
                        onValueChange={setBillDiscountValue}
                        mode={billDiscountMode}
                        onModeToggle={() => setBillDiscountMode((m) => (m === "percent" ? "amount" : "percent"))}
                        amount={billDiscountAmount}
                    />
                </div>

                <ReceiptNoteModal
                    open={noteModalOpen}
                    onOpenChange={setNoteModalOpen}
                    initialNote={receiptNote}
                    onSave={setReceiptNote}
                />

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
                    <div className="flex items-center gap-2 flex-wrap">
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
                        {/* Up-to-date Sale (end-of-day summary) — same affordance as the
                canteen POS so cashiers / managers can run EOD without leaving
                the store till. */}
                        {hasRole("cashier", "manager", "admin") && user?.shopId && (
                            <UpToDateSaleButton
                                shopId={user.shopId}
                                shopName={user?.shopName}
                                schoolInfo={schoolInfo}
                            />
                        )}
                        {canManageOrder && user?.shopId && (
                            reorderMode ? (
                                <div className="flex items-center gap-1.5">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={cancelReorderMode}
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
                    <ProductSearchDropdown
                        dropdownRef={dropdownRef}
                        searchInputRef={searchInputRef}
                        searchTerm={searchTerm}
                        onSearchTermChange={(v) => {
                            setSearchTerm(v);
                            setDropdownOpen(v.trim().length > 0);
                            setHighlightedIndex(0);
                        }}
                        onKeyDown={handleSearchKeyDown}
                        onFocus={() => searchTerm.trim() && setDropdownOpen(true)}
                        dropdownOpen={dropdownOpen}
                        highlightedIndex={highlightedIndex}
                        onHighlight={setHighlightedIndex}
                        suggestions={suggestions}
                        onCommit={commitSuggestion}
                        priceMode={priceMode}
                        getPrice={getPrice}
                    />
                </div>


                {/* Panel selector — only shown for shop-scoped users with panels */}
                {user?.shopId && panels.length > 0 && (
                    <div className="flex items-center flex-wrap gap-2 pb-1">
                        <span className="text-xs font-semibold text-muted-foreground shrink-0">{t("store.priceLabel")}</span>
                        <button
                            type="button"
                            onClick={() => setActivePanelId(null)}
                            className={cn(
                                "rounded-full border px-3 py-1 text-xs font-medium transition",
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
                                    "rounded-full border px-3 py-1 text-xs font-medium transition",
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
                <ProductReorderGrid
                    allProducts={allProducts}
                    setAllProducts={setAllProducts}
                    reorderMode={reorderMode}
                    reorderItems={reorderItems}
                    sensors={sensors}
                    collisionDetection={collisionDetection}
                    onDragEnd={handleDragEnd}
                    activePanelId={activePanelId}
                    panelIncluded={panelIncluded}
                    panelShortNames={panelShortNames}
                    priceMode={priceMode}
                    getPrice={getPrice}
                    addToCart={addToCart}
                    shopId={user?.shopId}
                    canEditColor={hasRole("manager", "admin")}
                />
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
                shopKind="store"
                onBack={handleBackToPicker}
                onConfirm={handleConfirmWallet}
                confirming={confirming}
                onPayerIdentified={(s) => {
                    display.review({
                        items: buildDisplayItems(),
                        total,
                        payer: s ? payerForCustomer({ ...s, spendingLimit: storeSpendingLimit(s) }, total) : null,
                    });
                }}
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

            {/* QR — modal owns the BAY intent lifecycle now. */}
            <QrPaymentModal
                open={qrOpen}
                onOpenChange={setQrOpen}
                total={total}
                onBack={handleBackToPicker}
                buildCartPayload={() => ({
                    transaction_mode: "sale",
                    payer_kind: "customer",
                    shop_id: user?.shopId ?? undefined,
                    discount: billDiscountAmount,
                    items: cart.map((i) => ({
                        product_variant_id: i.id,
                        quantity: i.quantity,
                        unit_price: i.price,
                        price_override: i.priceOverride ?? null,
                        discount: 0,
                        options: [],
                    })),
                })}
                onPaid={(info) => {
                    setQrOpen(false);
                    setLastReceipt({
                        receiptNumber: info.receiptNumber ?? "",
                        amount: total,
                        remainingBalance: undefined,
                        studentName: null,
                        studentPhotoUrl: null,
                        studentGrade: null,
                    });
                    setSuccessOpen(true);
                }}
                onIntentReady={(info) => {
                    if (info) {
                        display.qr({
                            items: buildDisplayItems(),
                            total,
                            qrPayload: info.qrPayload,
                            expiresAt: null,
                        });
                    } else {
                        display.standby();
                    }
                }}
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
                onClose={() => {
                    setSuccessOpen(false);
                    // Cashier acknowledged the receipt — release the customer
                    // display back to standby so the next customer sees a clean
                    // welcome screen.
                    display.standby();
                }}
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
            <SpecialItemPriceDialog
                product={specialItemTarget}
                onOpenChange={(open) => { if (!open) setSpecialItemTarget(null); }}
                onConfirm={(product, price) => {
                    setCart((prev) => [
                        ...prev,
                        { ...product, quantity: 1, priceOverride: price },
                    ]);
                    setLastAddedId(product.id);
                    setSpecialItemTarget(null);
                }}
            />

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
};

export default Store;
