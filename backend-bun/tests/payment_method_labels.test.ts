import { describe, expect, test } from "bun:test";
import {
    formatAggregatedPaymentMethodLabel,
    formatPaymentMethodLabel,
    resolvePaymentMethodLabelKey,
} from "@/lib/payment_method_labels";

describe("payment_method_labels", () => {
    test("wallet and legacy card_tap map to campus card", () => {
        expect(resolvePaymentMethodLabelKey("wallet")).toBe("campus_card");
        expect(resolvePaymentMethodLabelKey("CARD_TAP")).toBe("campus_card");
    });

    test("QR variants map to thai_qr", () => {
        expect(resolvePaymentMethodLabelKey("bay_qr")).toBe("thai_qr");
        expect(resolvePaymentMethodLabelKey("QR_PROMPTPAY")).toBe("thai_qr");
    });

    test("EDC splits on fee / masked card", () => {
        expect(resolvePaymentMethodLabelKey("edc")).toBe("edc_qr");
        expect(resolvePaymentMethodLabelKey("EDC", { edcCardFee: 3 })).toBe("edc_credit_card");
        expect(resolvePaymentMethodLabelKey("edc", { edcMaskedCard: "****1234" })).toBe("edc_credit_card");
    });

    test("online card types stay separate from EDC", () => {
        expect(formatPaymentMethodLabel("credit_card")).toBe("Credit Card");
        expect(formatPaymentMethodLabel("debit_card")).toBe("Debit Card");
        expect(formatPaymentMethodLabel("edc", { edcCardFee: 1 })).toBe("EDC Credit Card");
    });

    test("aggregated EDC row uses summed fee", () => {
        expect(formatAggregatedPaymentMethodLabel("EDC", 0)).toBe("EDC QR");
        expect(formatAggregatedPaymentMethodLabel("EDC", 12.5)).toBe("EDC Credit Card");
    });
});
