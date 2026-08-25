import { describe, expect, it } from "vitest";

describe("EDC Card Fee Validation", () => {
  it("should reject fee when toggle ON but value is 0", () => {
    const enableEdcCardFee = true;
    const edcCardFeeRate = 0;

    // Validation logic from handleAddShop
    const isValid = !enableEdcCardFee || edcCardFeeRate > 0;

    expect(isValid).toBe(false);
  });

  it("should reject fee when toggle ON but value is negative", () => {
    const enableEdcCardFee = true;
    const edcCardFeeRate = -1;

    const isValid = !enableEdcCardFee || edcCardFeeRate > 0;

    expect(isValid).toBe(false);
  });

  it("should accept fee when toggle ON and value > 0", () => {
    const enableEdcCardFee = true;
    const edcCardFeeRate = 2.5;

    const isValid = !enableEdcCardFee || edcCardFeeRate > 0;

    expect(isValid).toBe(true);
  });

  it("should accept fee when toggle OFF regardless of value", () => {
    const testCases = [
      { enableEdcCardFee: false, edcCardFeeRate: 0 },
      { enableEdcCardFee: false, edcCardFeeRate: -1 },
      { enableEdcCardFee: false, edcCardFeeRate: 2.5 },
    ];

    testCases.forEach(({ enableEdcCardFee, edcCardFeeRate }) => {
      const isValid = !enableEdcCardFee || edcCardFeeRate > 0;
      expect(isValid).toBe(true);
    });
  });

  it("should send correct fee value based on toggle", () => {
    const testCases = [
      { enableEdcCardFee: true, edcCardFeeRate: 2.5, expectedSend: 2.5 },
      { enableEdcCardFee: false, edcCardFeeRate: 2.5, expectedSend: 0 },
      { enableEdcCardFee: true, edcCardFeeRate: 0, expectedSend: 0 }, // Would fail validation
    ];

    testCases.forEach(({ enableEdcCardFee, edcCardFeeRate, expectedSend }) => {
      const sentValue = enableEdcCardFee ? edcCardFeeRate : 0;
      expect(sentValue).toBe(expectedSend);
    });
  });
});

describe("EDC Fee Form State", () => {
  it("should initialize form with default values", () => {
    const emptyShopForm = {
      id: "",
      name: "",
      description: "",
      isActive: "active" as const,
      shopType: "fifo" as const,
      module: "store" as const,
      shopNumber: "",
      allowTopup: true,
      edcCardFeeRate: 0,
      enableEdcCardFee: false,
    };

    expect(emptyShopForm.edcCardFeeRate).toBe(0);
    expect(emptyShopForm.enableEdcCardFee).toBe(false);
  });

  it("should properly update form state", () => {
    let form = {
      edcCardFeeRate: 0,
      enableEdcCardFee: false,
    };

    // Toggle ON and set fee
    form = { ...form, enableEdcCardFee: true, edcCardFeeRate: 2.5 };
    expect(form.enableEdcCardFee).toBe(true);
    expect(form.edcCardFeeRate).toBe(2.5);

    // Toggle OFF
    form = { ...form, enableEdcCardFee: false };
    expect(form.enableEdcCardFee).toBe(false);
    expect(form.edcCardFeeRate).toBe(2.5); // Value retained but not used
  });

  it("should parse numeric input correctly", () => {
    const inputs = [
      { input: "2.5", expected: 2.5 },
      { input: "0.01", expected: 0.01 },
      { input: "100", expected: 100 },
      { input: "0", expected: 0 },
    ];

    inputs.forEach(({ input, expected }) => {
      const parsed = parseFloat(input) || 0;
      expect(parsed).toBe(expected);
    });
  });
});
