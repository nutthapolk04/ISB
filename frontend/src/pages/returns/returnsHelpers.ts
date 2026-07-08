import type { TFunction } from "i18next";
import type { Receipt, SelectedItemsMap, ExchangeItemsMap } from "./returnsTypes";

// Compose the per-line key used by selectedItems / returnedQtyMap. Stays
// stable as long as the (productCode, bundleId) pair is unique within a
// receipt — which the backend guarantees.
export const itemKey = (item: { productCode: string; bundleId?: number | null }) =>
    `${item.productCode}::${item.bundleId ?? 0}`;

export const getPaymentMethodLabel = (t: TFunction, method: string | null | undefined) => {
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

/**
 * Derive what the backend WILL do when a refund is processed for the given
 * receipt. Mirrors `ReturnsService._derive_refund_destination` so the
 * confirmation dialog can show the destination before the call.
 */
export const getRefundDestinationPreview = (
    t: TFunction,
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

/** Build returnItems payload from selectedItems state */
export const buildReturnItems = (selectedItems: SelectedItemsMap) =>
    Object.values(selectedItems)
        .filter((d) => d.selected)
        .map((d) => ({
            productCode: d.productCode,
            returnQuantity: d.returnQty,
            bundleId: d.bundleId,
        }));

/** Build exchangeItems payload from exchangeItems state */
export const buildExchangeItems = (exchangeItems: ExchangeItemsMap) =>
    Object.entries(exchangeItems)
        .filter(([_, d]) => d.productCode)
        .map(([_, d]) => ({ productCode: d.productCode, quantity: d.quantity }));
