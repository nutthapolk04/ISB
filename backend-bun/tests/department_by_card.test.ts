import { describe, expect, it } from "bun:test";
import { getDepartmentByCard } from "../src/services/department_service";

describe("getDepartmentByCard", () => {
    it("returns null for empty uid", async () => {
        expect(await getDepartmentByCard("")).toBeNull();
    });

    it("returns null when no department matches", async () => {
        expect(await getDepartmentByCard("9999999999")).toBeNull();
    });
});
