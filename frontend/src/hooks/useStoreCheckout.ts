import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui/sonner";
import { api, ApiError } from "@/lib/api";
import { printReceipt, type ReceiptApi } from "@/lib/printReceipt";
import {
    afterPaymentPayer,
    cartToDisplayItems,
    payerForCustomer,
    payerForDepartment,
    payerForUser,
    paymentMethodForDisplay,
} from "@/lib/customerDisplay";
import type { useDisplayBroadcast, SpendingLimitData } from "@/hooks/useDisplayBroadcast";
import type { CanteenPaymentMethod } from "@/pages/canteen/PaymentMethodPicker";
import type { WalletPayer, StudentLookupResult } from "@/pages/canteen/RfidPaymentModal";
import type { DepartmentOption } from "@/pages/store/DepartmentPaymentModal";
import type { SchoolInfo } from "@/contexts/SchoolInfoContext";
import type { Product, CartItem, DiscountMode, LastReceipt } from "@/pages/store/storeTypes";

function storeSpendingLimit(s: { daily_limit_store?: number | null; spent_today_store?: number | null } | null): SpendingLimitData | null {
    if (!s || s.daily_limit_store == null) return null;
    const spent = s.spent_today_store ?? 0;
    return { daily_limit: s.daily_limit_store, spent_today: spent, remaining: Math.max(0, s.daily_limit_store - spent), group_name: "Daily Store Limit" };
}

interface UseStoreCheckoutArgs {
    shopId: string | null | undefined;
    shopName: string | null | undefined;
    activePanelId: number | null;
    panelPrices: Record<number, Record<number, number>>;
    panelShortNames: Record<number, Record<number, string>>;
    setAllProducts: React.Dispatch<React.SetStateAction<Product[]>>;
    autoPrint: boolean;
    schoolInfo: SchoolInfo;
    shopReceipt: { receiptHeader: string | null; receiptFooter: string | null } | null;
    departmentOptions: DepartmentOption[];
    display: ReturnType<typeof useDisplayBroadcast>;
}

interface CheckoutCtx {
    payer?: WalletPayer;
    deptId?: number;
    empCode?: string | null;
    edcRefs?: { approval_code: string; terminal_ref?: string; masked_card?: string; mode?: "qr" | "card" };
    cashReceived?: number;
}

/** Cart state + the full POS checkout pipeline (payment modals, doCheckout, receipt). */
export function useStoreCheckout({
    shopId,
    shopName,
    activePanelId,
    panelPrices,
    panelShortNames,
    setAllProducts,
    autoPrint,
    schoolInfo,
    shopReceipt,
    departmentOptions,
    display,
}: UseStoreCheckoutArgs) {
    const { t } = useTranslation();

    // ── Cart ────────────────────────────────────────────────────────────────
    const [cart, setCart] = useState<CartItem[]>([]);
    const [lastAddedId, setLastAddedId] = useState<number | null>(null);

    // ── Pricing ─────────────────────────────────────────────────────────────
    const [priceMode] = useState<"retail" | "internal">("retail");
    // Internal-issue mode requires identifying who took the goods.
    const [requesterUserId, setRequesterUserId] = useState<number | null>(null);

    // ── Bill discount ───────────────────────────────────────────────────────
    const [billDiscountValue, setBillDiscountValue] = useState<string>("");
    const [billDiscountMode, setBillDiscountMode] = useState<DiscountMode>("amount");

    // ── Receipt note (optional cashier memo, saved to receipt.notes) ────────
    const [receiptNote, setReceiptNote] = useState<string>("");
    const [noteModalOpen, setNoteModalOpen] = useState(false);

    // ── Modal pipeline state ────────────────────────────────────────────────
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

    const confirmSpecialItem = (product: Product, price: number) => {
        setCart((prev) => [
            ...prev,
            { ...product, quantity: 1, priceOverride: price },
        ]);
        setLastAddedId(product.id);
        setSpecialItemTarget(null);
    };

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

    const setItemPriceOverride = (id: number, price: number | null) => {
        setCart((prev) => prev.map((c) => (c.id === id ? { ...c, priceOverride: price } : c)));
    };

    const setItemDiscount = (id: number, value: number | null, mode: DiscountMode) => {
        setCart((prev) =>
            prev.map((c) => (c.id === id ? { ...c, discountValue: value ?? 0, discountMode: mode } : c)),
        );
    };

    const clearItemDiscount = (id: number) => {
        setCart((prev) => prev.map((c) => (c.id === id ? { ...c, discountValue: 0 } : c)));
    };

    // ── Derived pricing ─────────────────────────────────────────────────────
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

    // ── Checkout ────────────────────────────────────────────────────────────
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
                shop_id: shopId ?? undefined,
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
                edc_mode: ctx.edcRefs?.mode,
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
                        shopName,
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
                    ? preSelectedMember.customer_kind === "department"
                        ? payerForDepartment(
                            {
                                department_code: preSelectedMember.customer_code ?? null,
                                department_name: preSelectedMember.name,
                                wallet_balance: preSelectedMember.wallet_balance ?? null,
                            },
                            total,
                        )
                        : payerForCustomer({ ...preSelectedMember, spendingLimit: storeSpendingLimit(preSelectedMember) }, total)
                    : null,
        });

        // If member is pre-selected, charge directly — department members
        // route through the dedicated department-charge path (institutional
        // billing, not a customer/user wallet deduction); everyone else pays
        // by wallet.
        if (preSelectedMember) {
            setConfirming(true);
            try {
                if (preSelectedMember.customer_kind === "department") {
                    await doCheckout("department", { deptId: preSelectedMember.id, empCode: null });
                } else {
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
                }
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
    const handleConfirmEdc = (refs: { approval_code: string; terminal_ref?: string; masked_card?: string; mode: "qr" | "card" }) =>
        doCheckout("edc", { edcRefs: refs });

    // ── Available payment methods ───────────────────────────────────────────
    const availableMethods: CanteenPaymentMethod[] = ["wallet", "cash", "qr", "edc"];

    return {
        cart,
        lastAddedId,
        addToCart,
        updateQuantity,
        removeFromCart,
        clearCart,
        setItemPriceOverride,
        setItemDiscount,
        clearItemDiscount,
        getPriceForItem,
        getItemDiscountAmount,
        getItemLineTotal,
        buildDisplayItems,
        subtotal,
        itemCount,
        billDiscountValue,
        setBillDiscountValue,
        billDiscountMode,
        setBillDiscountMode,
        billDiscountAmount,
        total,
        receiptNote,
        setReceiptNote,
        noteModalOpen,
        setNoteModalOpen,
        specialItemTarget,
        setSpecialItemTarget,
        confirmSpecialItem,
        methodPickerOpen,
        setMethodPickerOpen,
        walletOpen,
        setWalletOpen,
        cashOpen,
        setCashOpen,
        qrOpen,
        setQrOpen,
        deptOpen,
        setDeptOpen,
        edcOpen,
        setEdcOpen,
        successOpen,
        setSuccessOpen,
        memberSearchOpen,
        setMemberSearchOpen,
        topupOpen,
        setTopupOpen,
        confirming,
        lastReceipt,
        setLastReceipt,
        walletLimitError,
        setWalletLimitError,
        preSelectedMember,
        setPreSelectedMember,
        paymentModalOpen,
        chipRefreshKey,
        handleOpenPayment,
        handlePickMethod,
        handleBackToPicker,
        handleConfirmWallet,
        handleConfirmCash,
        handleConfirmDept,
        handleConfirmEdc,
        availableMethods,
    };
}
