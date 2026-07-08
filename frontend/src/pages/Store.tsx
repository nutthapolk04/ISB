import { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import {
    ShoppingCart,
    UserSearch,
    Wallet,
    X,
    ArrowUpDown,
    Check,
    Printer,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useDisplayBroadcast } from "@/hooks/useDisplayBroadcast";
import { useProductReorder } from "@/hooks/useProductReorder";
import { useStoreRfidScanner } from "@/hooks/useStoreRfidScanner";
import { useStoreCheckout } from "@/hooks/useStoreCheckout";
import { autoOpenCustomerDisplayWindow } from "@/lib/customerDisplayWindow";
import { payerForCustomer } from "@/lib/customerDisplay";
import type { SpendingLimitData } from "@/hooks/useDisplayBroadcast";

function storeSpendingLimit(s: { daily_limit_store?: number | null; spent_today_store?: number | null } | null): SpendingLimitData | null {
    if (!s || s.daily_limit_store == null) return null;
    const spent = s.spent_today_store ?? 0;
    return { daily_limit: s.daily_limit_store, spent_today: spent, remaining: Math.max(0, s.daily_limit_store - spent), group_name: "Daily Store Limit" };
}

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PaymentMethodPicker } from "./canteen/PaymentMethodPicker";
import { CashPaymentModal } from "./canteen/CashPaymentModal";
import { QrPaymentModal } from "./canteen/QrPaymentModal";
import { RfidPaymentModal } from "./canteen/RfidPaymentModal";
import { ReceiptSuccessModal } from "./canteen/ReceiptSuccessModal";
import { DepartmentPaymentModal, type DepartmentOption } from "./store/DepartmentPaymentModal";
import { EdcPaymentModal } from "./store/EdcPaymentModal";
import { MemberSearchModal } from "./canteen/MemberSearchModal";
import { UpToDateSaleButton } from "@/components/canteen/UpToDateSaleButton";
import { CashierTopupModal } from "@/components/CashierTopupModal";
import { Switch } from "@/components/ui/switch";
import { useAutoPrint } from "@/hooks/useAutoPrint";
import { ProductReorderGrid } from "./store/ProductReorderGrid";
import { ProductSearchDropdown } from "./store/ProductSearchDropdown";
import { CartPanel } from "./store/CartPanel";
import { SpecialItemPriceDialog } from "./store/SpecialItemPriceDialog";
import { panelColorClass } from "./store/storeTypes";
import type { Product } from "./store/storeTypes";

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

    // ── Browse + search ─────────────────────────────────────────────────────
    const [searchTerm, setSearchTerm] = useState("");
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);

    // ── Customer display broadcast (second-monitor) ─────────────────────────
    const display = useDisplayBroadcast();

    // Reset the customer-facing window to the standby rotation whenever the
    // cashier enters this POS page. Without this, a stale "review" / "success"
    // state from a previous session can stick around in the popup and hide the
    // image rotation until the cashier starts a new checkout.
    useEffect(() => {
        display.standby();
    }, [display]);

    // ── Mobile cart sheet ────────────────────────────────────────────────────
    const [cartSheetOpen, setCartSheetOpen] = useState(false);

    // ── Cart + checkout pipeline ─────────────────────────────────────────────
    const checkout = useStoreCheckout({
        shopId: user?.shopId,
        shopName: user?.shopName,
        activePanelId,
        panelPrices,
        panelShortNames,
        setAllProducts,
        autoPrint,
        schoolInfo,
        shopReceipt,
        departmentOptions,
        display,
    });

    // ── Passive RFID/barcode listener (page-level, no input focused) ────────
    const rfidScanner = useStoreRfidScanner({
        products: allProducts,
        onProductMatch: checkout.addToCart,
        onMemberFound: checkout.setPreSelectedMember,
    });

    // ── Department charge gating ────────────────────────────────────────────
    const canUseDeptCharge = useMemo(() => {
        if (shopsMeta.length === 0) return true;
        const cartShopIds = new Set(checkout.cart.map((i) => i.subMerchantId).filter(Boolean) as string[]);
        if (cartShopIds.size > 0) {
            return Array.from(cartShopIds).every(
                (sid) => shopsMeta.find((s) => s.id === sid)?.allow_department_charge === true,
            );
        }
        if (user?.shopId) {
            return shopsMeta.find((s) => s.id === user.shopId)?.allow_department_charge === true;
        }
        return shopsMeta.some((s) => s.allow_department_charge);
    }, [shopsMeta, checkout.cart, user?.shopId]);

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

    // ── Search handlers ─────────────────────────────────────────────────────
    const commitSuggestion = (product: Product) => {
        checkout.addToCart(product);
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
                            onClick={() => checkout.setTopupOpen(true)}
                            className="gap-1.5"
                        >
                            <Wallet className="h-4 w-4" />
                            <span className="hidden sm:inline">{t("store.topup", "เติมเงิน")}</span>
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => checkout.setMemberSearchOpen(true)}
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
                        priceMode="retail"
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
                    priceMode="retail"
                    getPrice={getPrice}
                    addToCart={checkout.addToCart}
                    shopId={user?.shopId}
                    canEditColor={hasRole("manager", "admin")}
                />
            </div>

            {/* Desktop cart panel (≥lg) */}
            <CartPanel
                asSheet={false}
                itemCount={checkout.itemCount}
                cart={checkout.cart}
                lastAddedId={checkout.lastAddedId}
                onClearCart={checkout.clearCart}
                onUpdateQuantity={checkout.updateQuantity}
                onRemoveFromCart={checkout.removeFromCart}
                onSetPriceOverride={checkout.setItemPriceOverride}
                onItemDiscountChange={checkout.setItemDiscount}
                onItemDiscountClear={checkout.clearItemDiscount}
                getPriceForItem={checkout.getPriceForItem}
                getItemLineTotal={checkout.getItemLineTotal}
                preSelectedMember={checkout.preSelectedMember}
                onClearMember={() => checkout.setPreSelectedMember(null)}
                subtotal={checkout.subtotal}
                billDiscountAmount={checkout.billDiscountAmount}
                billDiscountValue={checkout.billDiscountValue}
                onBillDiscountValueChange={checkout.setBillDiscountValue}
                billDiscountMode={checkout.billDiscountMode}
                onBillDiscountModeToggle={() => checkout.setBillDiscountMode((m) => (m === "percent" ? "amount" : "percent"))}
                receiptNote={checkout.receiptNote}
                noteModalOpen={checkout.noteModalOpen}
                onNoteModalOpenChange={checkout.setNoteModalOpen}
                onSaveNote={checkout.setReceiptNote}
                total={checkout.total}
                confirming={checkout.confirming}
                onCharge={checkout.handleOpenPayment}
            />

            {/* Mobile floating cart trigger */}
            {checkout.cart.length > 0 && (
                <Button
                    onClick={() => setCartSheetOpen(true)}
                    className="lg:hidden fixed bottom-4 right-4 z-40 h-14 px-5 rounded-full text-base font-bold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-lg shadow-amber-400/50"
                >
                    <ShoppingCart className="h-5 w-5 mr-2" />
                    <span className="tabular-nums">฿{checkout.total.toFixed(0)} · {checkout.itemCount}</span>
                </Button>
            )}

            {/* Mobile cart sheet */}
            <Sheet open={cartSheetOpen} onOpenChange={setCartSheetOpen}>
                <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col lg:hidden">
                    <CartPanel
                        asSheet={true}
                        itemCount={checkout.itemCount}
                        cart={checkout.cart}
                        lastAddedId={checkout.lastAddedId}
                        onClearCart={checkout.clearCart}
                        onUpdateQuantity={checkout.updateQuantity}
                        onRemoveFromCart={checkout.removeFromCart}
                        onSetPriceOverride={checkout.setItemPriceOverride}
                        onItemDiscountChange={checkout.setItemDiscount}
                        onItemDiscountClear={checkout.clearItemDiscount}
                        getPriceForItem={checkout.getPriceForItem}
                        getItemLineTotal={checkout.getItemLineTotal}
                        preSelectedMember={checkout.preSelectedMember}
                        onClearMember={() => checkout.setPreSelectedMember(null)}
                        subtotal={checkout.subtotal}
                        billDiscountAmount={checkout.billDiscountAmount}
                        billDiscountValue={checkout.billDiscountValue}
                        onBillDiscountValueChange={checkout.setBillDiscountValue}
                        billDiscountMode={checkout.billDiscountMode}
                        onBillDiscountModeToggle={() => checkout.setBillDiscountMode((m) => (m === "percent" ? "amount" : "percent"))}
                        receiptNote={checkout.receiptNote}
                        noteModalOpen={checkout.noteModalOpen}
                        onNoteModalOpenChange={checkout.setNoteModalOpen}
                        onSaveNote={checkout.setReceiptNote}
                        total={checkout.total}
                        confirming={checkout.confirming}
                        onCharge={() => { setCartSheetOpen(false); checkout.handleOpenPayment(); }}
                    />
                </SheetContent>
            </Sheet>

            {/* Payment method picker */}
            <PaymentMethodPicker
                open={checkout.methodPickerOpen}
                onOpenChange={checkout.setMethodPickerOpen}
                total={checkout.total}
                methods={checkout.availableMethods}
                walletLabel={t("store.studentCard", "บัตรนักเรียน")}
                onSelect={checkout.handlePickMethod}
            />

            {/* Wallet (student / parent / staff card) */}
            <RfidPaymentModal
                open={checkout.walletOpen}
                onOpenChange={checkout.setWalletOpen}
                total={checkout.total}
                shopKind="store"
                onBack={checkout.handleBackToPicker}
                onConfirm={checkout.handleConfirmWallet}
                confirming={checkout.confirming}
                onPayerIdentified={(s) => {
                    display.review({
                        items: checkout.buildDisplayItems(),
                        total: checkout.total,
                        payer: s ? payerForCustomer({ ...s, spendingLimit: storeSpendingLimit(s) }, checkout.total) : null,
                    });
                }}
            />

            {/* Cash */}
            <CashPaymentModal
                open={checkout.cashOpen}
                onOpenChange={checkout.setCashOpen}
                total={checkout.total}
                onBack={checkout.handleBackToPicker}
                onConfirm={checkout.handleConfirmCash}
                confirming={checkout.confirming}
            />

            {/* QR — modal owns the BAY intent lifecycle now. */}
            <QrPaymentModal
                open={checkout.qrOpen}
                onOpenChange={checkout.setQrOpen}
                total={checkout.total}
                onBack={checkout.handleBackToPicker}
                buildCartPayload={() => ({
                    transaction_mode: "sale",
                    payer_kind: "customer",
                    shop_id: user?.shopId ?? undefined,
                    discount: checkout.billDiscountAmount,
                    items: checkout.cart.map((i) => ({
                        product_variant_id: i.id,
                        quantity: i.quantity,
                        unit_price: i.price,
                        price_override: i.priceOverride ?? null,
                        discount: 0,
                        options: [],
                    })),
                })}
                onPaid={(info) => {
                    checkout.setQrOpen(false);
                    checkout.setLastReceipt({
                        receiptNumber: info.receiptNumber ?? "",
                        amount: checkout.total,
                        remainingBalance: undefined,
                        studentName: null,
                        studentPhotoUrl: null,
                        studentGrade: null,
                    });
                    checkout.setSuccessOpen(true);
                }}
                onIntentReady={(info) => {
                    if (info) {
                        display.qr({
                            items: checkout.buildDisplayItems(),
                            total: checkout.total,
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
                open={checkout.deptOpen}
                onOpenChange={checkout.setDeptOpen}
                total={checkout.total}
                departments={departmentOptions}
                onBack={checkout.handleBackToPicker}
                onConfirm={checkout.handleConfirmDept}
                confirming={checkout.confirming}
            />

            {/* EDC */}
            <EdcPaymentModal
                open={checkout.edcOpen}
                onOpenChange={checkout.setEdcOpen}
                total={checkout.total}
                onBack={checkout.handleBackToPicker}
                onConfirm={checkout.handleConfirmEdc}
                confirming={checkout.confirming}
            />

            {/* Receipt success */}
            <ReceiptSuccessModal
                open={checkout.successOpen}
                onClose={() => {
                    checkout.setSuccessOpen(false);
                    // Cashier acknowledged the receipt — release the customer
                    // display back to standby so the next customer sees a clean
                    // welcome screen.
                    display.standby();
                }}
                receiptNumber={checkout.lastReceipt?.receiptNumber ?? ""}
                amount={checkout.lastReceipt?.amount ?? 0}
                remainingBalance={checkout.lastReceipt?.remainingBalance ?? null}
                studentName={checkout.lastReceipt?.studentName ?? null}
                studentPhotoUrl={checkout.lastReceipt?.studentPhotoUrl ?? null}
                studentGrade={checkout.lastReceipt?.studentGrade ?? null}
            />

            {/* Member search */}
            <MemberSearchModal
                open={checkout.memberSearchOpen}
                onOpenChange={checkout.setMemberSearchOpen}
                onSelect={(member) => {
                    checkout.setPreSelectedMember(member);
                    checkout.setMemberSearchOpen(false);
                }}
            />

            {/* Cashier top-up */}
            <CashierTopupModal
                open={checkout.topupOpen}
                onOpenChange={checkout.setTopupOpen}
            />

            {/* Special item — cashier enters price before adding to cart */}
            <SpecialItemPriceDialog
                product={checkout.specialItemTarget}
                onOpenChange={(open) => { if (!open) checkout.setSpecialItemTarget(null); }}
                onConfirm={checkout.confirmSpecialItem}
            />

            {/* Wallet limit exceeded — prominent AlertDialog */}
            <AlertDialog open={!!checkout.walletLimitError} onOpenChange={(o) => { if (!o) checkout.setWalletLimitError(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-red-600">{t("store.insufficientBalance")}</AlertDialogTitle>
                        <AlertDialogDescription className="text-sm text-foreground">
                            {checkout.walletLimitError}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogAction onClick={() => checkout.setWalletLimitError(null)}>
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
