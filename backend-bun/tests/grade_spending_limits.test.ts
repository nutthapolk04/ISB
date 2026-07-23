import { describe, expect, it } from "bun:test";
import {
    classifyGradeTier,
    resolveStudentSpendingLimits,
} from "../src/services/grade_spending_limits";

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

describe("resolveStudentSpendingLimits", () => {
    it("sets upper defaults for a new grade-05 student", () => {
        const r = resolveStudentSpendingLimits({
            isNew: true,
            newGrade: "05",
            oldGrade: null,
            currentCanteen: null,
            currentStore: null,
        });
        expect(r).toEqual({
            canteen: "500.00",
            store: "25000.00",
            reason: "init",
        });
    });

    it("sets lower defaults for a new K1 student", () => {
        const r = resolveStudentSpendingLimits({
            isNew: true,
            newGrade: "K1",
            oldGrade: null,
            currentCanteen: null,
            currentStore: null,
        });
        expect(r.canteen).toBe("0.10");
        expect(r.store).toBe("0.10");
        expect(r.reason).toBe("init");
    });

    it("fills null limits on every sync for existing students", () => {
        const r = resolveStudentSpendingLimits({
            isNew: false,
            newGrade: "03",
            oldGrade: "03",
            currentCanteen: null,
            currentStore: null,
        });
        expect(r.canteen).toBe("0.10");
        expect(r.store).toBe("0.10");
        expect(r.reason).toBe("null_fill");
    });

    it("promotes lower→upper: keeps column > 1, updates column ≤ 1", () => {
        const r = resolveStudentSpendingLimits({
            isNew: false,
            newGrade: "05",
            oldGrade: "04",
            currentCanteen: "800.00",
            currentStore: "0.50",
        });
        expect(r.canteen).toBeNull();
        expect(r.store).toBe("25000.00");
        expect(r.reason).toBe("promote");
    });

    it("promotes K1→05 with both limits ≤ 1", () => {
        const r = resolveStudentSpendingLimits({
            isNew: false,
            newGrade: "05",
            oldGrade: "K1",
            currentCanteen: "0.10",
            currentStore: "1.00",
        });
        expect(r.canteen).toBe("500.00");
        expect(r.store).toBe("25000.00");
        expect(r.reason).toBe("promote");
    });

    it("does not change non-null limits when staying in the same tier", () => {
        const r = resolveStudentSpendingLimits({
            isNew: false,
            newGrade: "03",
            oldGrade: "02",
            currentCanteen: "500.00",
            currentStore: "100.00",
        });
        expect(r.canteen).toBeNull();
        expect(r.store).toBeNull();
        expect(r.reason).toBeNull();
    });

    it("skips when grade is unknown", () => {
        const r = resolveStudentSpendingLimits({
            isNew: true,
            newGrade: "Pre-K",
            oldGrade: null,
            currentCanteen: null,
            currentStore: null,
        });
        expect(r.reason).toBeNull();
    });
});
