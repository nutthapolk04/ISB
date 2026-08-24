/**
 * Pins the fix for the 2026-08 top-up shortfall: a wheel scroll over the
 * focused amount field silently decremented ฿1,000 to ฿995, and every layer
 * below the input — submit, cashierTopup, adjustBalance, the printed receipt —
 * passed that value through faithfully, so nothing downstream could catch it.
 */
import { describe, expect, it, vi } from "vitest";
import { blurOnWheel } from "./numberInputGuards";

describe("blurOnWheel", () => {
    it("blurs the input so the browser cannot apply the wheel delta", () => {
        const blur = vi.fn();
        blurOnWheel({ currentTarget: { blur } });
        expect(blur).toHaveBeenCalledTimes(1);
    });

    it("does not throw when there is nothing to blur", () => {
        // Defensive: a synthetic event replayed after React pooled/detached it
        // must not take the whole POS page down over a scroll.
        expect(() => blurOnWheel({ currentTarget: null })).not.toThrow();
        expect(() => blurOnWheel({})).not.toThrow();
        expect(() => blurOnWheel({ currentTarget: {} })).not.toThrow();
    });
});
