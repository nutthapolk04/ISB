import { describe, expect, test } from "bun:test";
import { classifyTopupChannel } from "@/services/wallet_tx_classify";

describe("classifyTopupChannel", () => {
    test("staff-parent topping up linked child via portal is online", () => {
        expect(classifyTopupChannel({
            transactionType: "TOPUP",
            reason: null,
            description: "Top-up via PromptPay (BAY) (TOP-20260804-001-aa)",
            creatorRole: "staff",
            isFamilyPortalTopup: true,
        })).toBe("online");
    });

    test("cashier at POS with shop stays cashier even for own child", () => {
        expect(classifyTopupChannel({
            transactionType: "TOPUP",
            reason: null,
            description: "Top-up via PromptPay (BAY)",
            creatorRole: "cashier",
            isFamilyPortalTopup: false,
        })).toBe("cashier");
    });

    test("plain parent role is online without family flag", () => {
        expect(classifyTopupChannel({
            transactionType: "TOPUP",
            reason: null,
            description: null,
            creatorRole: "parent",
        })).toBe("online");
    });

    test("cash POS adjustment is cashier", () => {
        expect(classifyTopupChannel({
            transactionType: "ADJUSTMENT",
            reason: "Cash top-up at POS",
            description: null,
            creatorRole: "cashier",
        })).toBe("cashier");
    });
});
