import { describe, expect, it } from "bun:test";
import { classifyGradeTier } from "../src/services/grade_spending_limits";

describe("classifyGradeTier", () => {
    it("classifies kindergarten and 00-04 as low", () => {
        expect(classifyGradeTier("K0")).toBe("low");
        expect(classifyGradeTier("K1")).toBe("low");
        expect(classifyGradeTier("00")).toBe("low");
        expect(classifyGradeTier("04")).toBe("low");
    });

    it("classifies 05-12 as high", () => {
        expect(classifyGradeTier("05")).toBe("high");
        expect(classifyGradeTier("12")).toBe("high");
    });

    it("returns null for unknown grades", () => {
        expect(classifyGradeTier(null)).toBeNull();
        expect(classifyGradeTier("STAFF")).toBeNull();
    });
});
