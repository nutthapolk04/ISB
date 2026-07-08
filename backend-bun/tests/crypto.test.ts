import { describe, expect, it } from "bun:test";
import { timingSafeEqual } from "../src/lib/crypto";

describe("timingSafeEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
  });

  it("returns false for different-length strings", () => {
    expect(timingSafeEqual("short", "muchlongerstring")).toBe(false);
  });

  it("returns false when one string is empty", () => {
    expect(timingSafeEqual("", "nonempty")).toBe(false);
  });

  it("returns true when both strings are empty", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
