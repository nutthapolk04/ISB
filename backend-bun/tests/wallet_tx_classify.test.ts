import { describe, expect, test } from "bun:test";
import { classifyTopupChannel, isFamilyPortalGatewayTopup } from "@/services/wallet_tx_classify";

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

    test("staff-parent topping up co-parent via portal is online", () => {
        expect(classifyTopupChannel({
            transactionType: "TOPUP",
            reason: null,
            description: "Top-up via PromptPay (BAY)",
            creatorRole: "staff",
            isFamilyPortalTopup: true,
        })).toBe("online");
    });
});

describe("isFamilyPortalGatewayTopup", () => {
    test("linked child wallet with parent_child_links", () => {
        expect(isFamilyPortalGatewayTopup({
            transactionType: "TOPUP",
            creatorShopId: null,
            creatorId: 10,
            creatorFamilyCode: "FAM1",
            walletUserId: null,
            walletCustomerId: 99,
            hasParentChildLink: true,
            walletOwnerFamilyCode: null,
        })).toBe(true);
    });

    test("co-parent user wallet with shared family_code", () => {
        expect(isFamilyPortalGatewayTopup({
            transactionType: "TOPUP",
            creatorShopId: null,
            creatorId: 10,
            creatorFamilyCode: "202358",
            walletUserId: 20,
            walletCustomerId: null,
            hasParentChildLink: false,
            walletOwnerFamilyCode: "202358",
        })).toBe(true);
    });

    test("self top-up is not family portal (handled separately)", () => {
        expect(isFamilyPortalGatewayTopup({
            transactionType: "TOPUP",
            creatorShopId: null,
            creatorId: 10,
            creatorFamilyCode: "202358",
            walletUserId: 10,
            walletCustomerId: null,
            hasParentChildLink: false,
            walletOwnerFamilyCode: "202358",
        })).toBe(false);
    });

    test("POS cashier with shop_id is not family portal", () => {
        expect(isFamilyPortalGatewayTopup({
            transactionType: "TOPUP",
            creatorShopId: "bookstore",
            creatorId: 10,
            creatorFamilyCode: "FAM1",
            walletUserId: null,
            walletCustomerId: 99,
            hasParentChildLink: true,
            walletOwnerFamilyCode: null,
        })).toBe(false);
    });

    test("unrelated user wallet with different family_code", () => {
        expect(isFamilyPortalGatewayTopup({
            transactionType: "TOPUP",
            creatorShopId: null,
            creatorId: 10,
            creatorFamilyCode: "FAM1",
            walletUserId: 30,
            walletCustomerId: null,
            hasParentChildLink: false,
            walletOwnerFamilyCode: "FAM2",
        })).toBe(false);
    });
});
