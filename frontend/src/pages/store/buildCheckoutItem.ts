/**
 * One cart item → one /pos/checkout (or /pos/qr-intent) line item.
 *
 * Extracted so every call site that builds a checkout payload from the Store
 * cart shares this exact branch, instead of re-implementing it. A bundle cart
 * item carries a synthetic negative `id` (see loadShopProducts in Store.tsx —
 * "Use a negative ID space to avoid collision with real product IDs") purely
 * so it doesn't collide with a real `shop_products.id` in the merged
 * catalog array; the real bundle PK lives in `bundleId`. Sending that
 * synthetic `id` to the backend as `product_variant_id` is meaningless there
 * (it's not a real row), and one call site did exactly that: the QR-payment
 * cart-payload builder skipped this branch, so a bundle sale paid via Thai QR
 * stored `product_variant_id: -3` in the payment intent's cart_snapshot. That
 * only surfaced once the BAY webhook tried to check it out — after the
 * customer had already paid — as "Product id=-3 not found", permanently
 * stuck (see pos_qr_service.ts's confirmPosQrSale for the other half of that
 * incident, 2026-08-10, ref=POS-20260810-2H13YJ).
 */
import type { CartItem } from "./storeTypes";

export interface CheckoutItemPayload {
    product_variant_id: number;
    quantity: number;
    unit_price: number;
    price_override: number | null;
    discount: number;
    is_bundle?: true;
    bundle_id?: number;
    options?: never[];
}

export function buildCheckoutItem(
    item: Pick<CartItem, "id" | "quantity" | "priceOverride" | "isBundle" | "bundleId">,
    opts: { unitPrice: number; discount: number },
): CheckoutItemPayload {
    if (item.isBundle && item.bundleId != null) {
        return {
            // product_variant_id is unused by the backend for bundle items,
            // but the field is required by the schema — send 0 as sentinel.
            product_variant_id: 0,
            quantity: item.quantity,
            unit_price: opts.unitPrice,
            price_override: item.priceOverride ?? null,
            discount: opts.discount,
            is_bundle: true,
            bundle_id: item.bundleId,
        };
    }
    return {
        product_variant_id: item.id,
        quantity: item.quantity,
        unit_price: opts.unitPrice,
        price_override: item.priceOverride ?? null,
        discount: opts.discount,
        options: [],
    };
}
