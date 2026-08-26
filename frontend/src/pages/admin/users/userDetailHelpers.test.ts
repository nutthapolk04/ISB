import { describe, expect, it } from "vitest";
import { shouldShowFamilyCard } from "./userDetailHelpers";

describe("shouldShowFamilyCard", () => {
    it("shows the card for a household member with a family code", () => {
        expect(shouldShowFamilyCard("parent", "601001")).toBe(true);
        expect(shouldShowFamilyCard("staff", "601001")).toBe(true);
    });

    it("hides it for an ISB 'other' card even when a family code is stored", () => {
        // The regression: ISB drops the whole family from /sync/families when a
        // parent becomes an "other", so nothing clears the old household — and
        // the sweep skips role='other'. Without this the card renders the stale
        // family, former login email included, indefinitely.
        expect(shouldShowFamilyCard("other", "601001")).toBe(false);
    });

    it("hides it when there is no family code at all", () => {
        expect(shouldShowFamilyCard("parent", null)).toBe(false);
        expect(shouldShowFamilyCard("parent", undefined)).toBe(false);
        expect(shouldShowFamilyCard("parent", "")).toBe(false);
        expect(shouldShowFamilyCard("other", null)).toBe(false);
    });

    it("does not hide it for a role we simply do not know", () => {
        // Only "other" is non-household; an unknown or missing role must not
        // silently strip an admin's view of a real family.
        expect(shouldShowFamilyCard(null, "601001")).toBe(true);
        expect(shouldShowFamilyCard("teacher", "601001")).toBe(true);
    });
});
