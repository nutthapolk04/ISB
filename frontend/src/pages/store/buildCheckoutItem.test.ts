/**
 * Regression coverage for the 2026-08-10 incident (ref=POS-20260810-2H13YJ):
 * a bundle cart item's synthetic negative id leaked into `product_variant_id`
 * on the QR-payment path, which only surfaced after the customer had already
 * paid ("Product id=-3 not found", permanently stuck — see
 * backend-bun/src/services/pos_qr_service.ts).
 */
import { describe, expect, it } from "vitest";
import { buildCheckoutItem } from "./buildCheckoutItem";
import type { CartItem } from "./storeTypes";

function cartItem(overrides: Partial<CartItem> = {}): CartItem {
    return {
        id: 42,
        productCode: "SKU-42",
        barcode: "42",
        name: "Test Item",
        price: 100,
        stock: 10,
        category: "Test",
        subMerchantId: "shop-1",
        quantity: 1,
        ...overrides,
    };
}

describe("buildCheckoutItem — normal (non-bundle) items", () => {
    it("sends the item's own id as product_variant_id", () => {
        const payload = buildCheckoutItem(cartItem({ id: 7 }), { unitPrice: 100, discount: 0 });
        expect(payload.product_variant_id).toBe(7);
        expect(payload.is_bundle).toBeUndefined();
        expect(payload.bundle_id).toBeUndefined();
    });

    it("passes through unit price, discount, and price override", () => {
        const payload = buildCheckoutItem(
            cartItem({ priceOverride: 55 }),
            { unitPrice: 100, discount: 12.5 },
        );
        expect(payload.unit_price).toBe(100);
        expect(payload.discount).toBe(12.5);
        expect(payload.price_override).toBe(55);
    });

    it("defaults price_override to null when unset", () => {
        const payload = buildCheckoutItem(cartItem(), { unitPrice: 100, discount: 0 });
        expect(payload.price_override).toBeNull();
    });

    it("does not special-case a negative id unless isBundle is also set", () => {
        // A negative id alone must not be treated as a bundle — routing is
        // driven by the isBundle flag, not by the sign of the id. Guards
        // against a future "helpful" refactor that infers bundle-ness from
        // `id < 0` instead of checking the flag.
        const payload = buildCheckoutItem(cartItem({ id: -3, isBundle: undefined }), {
            unitPrice: 100,
            discount: 0,
        });
        expect(payload.product_variant_id).toBe(-3);
        expect(payload.is_bundle).toBeUndefined();
    });
});

describe("buildCheckoutItem — bundle items (the incident)", () => {
    it("never sends the bundle's synthetic negative id as product_variant_id", () => {
        // This is the exact shape that broke: a bundle with real DB id=3,
        // represented in the cart with the synthetic id -3.
        const payload = buildCheckoutItem(
            cartItem({ id: -3, isBundle: true, bundleId: 3 }),
            { unitPrice: 250, discount: 0 },
        );
        expect(payload.product_variant_id).not.toBe(-3);
        expect(payload.product_variant_id).toBe(0);
    });

    it("sends is_bundle=true and the real bundle_id instead", () => {
        const payload = buildCheckoutItem(
            cartItem({ id: -3, isBundle: true, bundleId: 3 }),
            { unitPrice: 250, discount: 0 },
        );
        expect(payload.is_bundle).toBe(true);
        expect(payload.bundle_id).toBe(3);
    });

    it("omits options for bundle items", () => {
        const payload = buildCheckoutItem(
            cartItem({ id: -3, isBundle: true, bundleId: 3 }),
            { unitPrice: 250, discount: 0 },
        );
        expect(payload.options).toBeUndefined();
    });

    it("falls back to the normal branch when isBundle is true but bundleId is missing", () => {
        // Defensive: matches the existing `isBundle && bundleId != null` guard
        // rather than trusting isBundle alone, in case a caller ever sets one
        // flag without the other.
        const payload = buildCheckoutItem(
            cartItem({ id: -3, isBundle: true, bundleId: undefined }),
            { unitPrice: 250, discount: 0 },
        );
        expect(payload.product_variant_id).toBe(-3);
        expect(payload.is_bundle).toBeUndefined();
    });

    it("still carries discount and price override for bundle items", () => {
        const payload = buildCheckoutItem(
            cartItem({ id: -3, isBundle: true, bundleId: 3, priceOverride: 199 }),
            { unitPrice: 250, discount: 20 },
        );
        expect(payload.discount).toBe(20);
        expect(payload.price_override).toBe(199);
    });
});
