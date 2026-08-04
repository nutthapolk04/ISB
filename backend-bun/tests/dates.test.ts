import { describe, expect, it } from "bun:test";
import {
    bangkokDayRange,
    bangkokTodayCompact,
    bangkokTodayIso,
    bangkokRangeStart,
    bangkokRangeEndExclusive,
    bangkokDateRange,
} from "@/lib/dates";

describe("bangkokTodayIso", () => {
    it("uses Asia/Bangkok calendar date, not UTC", () => {
        // 2026-08-03 20:00 UTC = 2026-08-04 03:00 ICT
        const at = new Date("2026-08-03T20:00:00.000Z");
        expect(bangkokTodayIso(at)).toBe("2026-08-04");
        expect(bangkokTodayCompact(at)).toBe("20260804");
    });

    it("stays on previous day before midnight ICT", () => {
        // 2026-08-03 16:59 UTC = 2026-08-03 23:59 ICT
        const at = new Date("2026-08-03T16:59:59.000Z");
        expect(bangkokTodayIso(at)).toBe("2026-08-03");
    });

    it("flips at midnight ICT (17:00 UTC)", () => {
        const at = new Date("2026-08-03T17:00:00.000Z");
        expect(bangkokTodayIso(at)).toBe("2026-08-04");
    });
});

describe("bangkokDayRange", () => {
    it("anchors bounds to +07:00", () => {
        expect(bangkokDayRange("2026-08-04")).toEqual({
            start: "2026-08-04T00:00:00+07:00",
            end: "2026-08-04T23:59:59.999999+07:00",
        });
    });
});

describe("bangkokRangeEndExclusive", () => {
    it("is midnight ICT on the next calendar day", () => {
        expect(bangkokRangeEndExclusive("2026-08-03")).toBe("2026-08-04T00:00:00+07:00");
    });
});

describe("bangkokDateRange", () => {
    it("spans inclusive Bangkok calendar days", () => {
        expect(bangkokDateRange("2026-08-03", "2026-08-05")).toEqual({
            start: "2026-08-03T00:00:00+07:00",
            end: "2026-08-05T23:59:59.999999+07:00",
        });
    });
});

describe("bangkok boundary for filters", () => {
    it("excludes UTC instant that falls on the next Bangkok day", () => {
        const instant = new Date("2026-08-03T17:00:00.000Z").getTime();
        const start = new Date(bangkokRangeStart("2026-08-03")).getTime();
        const endExclusive = new Date(bangkokRangeEndExclusive("2026-08-03")).getTime();
        expect(instant >= start).toBe(true);
        expect(instant < endExclusive).toBe(false);
    });

    it("includes UTC instant still on the selected Bangkok day", () => {
        const instant = new Date("2026-08-03T16:59:59.999Z").getTime();
        const start = new Date(bangkokRangeStart("2026-08-03")).getTime();
        const endExclusive = new Date(bangkokRangeEndExclusive("2026-08-03")).getTime();
        expect(instant >= start).toBe(true);
        expect(instant < endExclusive).toBe(true);
    });
});
