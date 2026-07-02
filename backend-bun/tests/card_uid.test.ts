import { describe, expect, it } from "bun:test";
import { expandCardUidCandidates } from "@/lib/card_uid";

describe("expandCardUidCandidates", () => {
  it("expands POS reader1 hex to reversed hex and decimal", () => {
    const c = expandCardUidCandidates("D183880F");
    expect(c).toContain("D183880F");
    expect(c).toContain("0F8883D1");
    expect(c).toContain("3515058191");
  });

  it("expands POS reader2 decimal to hex variants", () => {
    const c = expandCardUidCandidates("3515058191");
    expect(c).toContain("3515058191");
    expect(c).toContain("D183880F");
    expect(c).toContain("0F8883D1");
  });

  it("expands kiosk reversed hex to forward hex", () => {
    const c = expandCardUidCandidates("0F8883D1");
    expect(c).toContain("0F8883D1");
    expect(c).toContain("D183880F");
    expect(c).toContain("3515058191");
  });

  it("pads odd-length hex with leading zero nibble", () => {
    const c = expandCardUidCandidates("0F883D1");
    expect(c).toContain("00F883D1");
  });

  it("does not expand plain student codes into hex noise", () => {
    const c = expandCardUidCandidates("85002");
    expect(c).toEqual(expect.arrayContaining(["85002"]));
    expect(c.some((v) => v.includes("D183"))).toBe(false);
  });
});
