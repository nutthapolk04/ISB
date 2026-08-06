/**
 * Terminal response-code classification.
 *
 * This is money logic in both directions, which is why it lives in its own
 * module with its own tests:
 *
 *  - Calling a real charge a "decline" puts a **Try again** button in front of a
 *    cashier whose customer has already paid → double charge. This is what
 *    happened before Y1/Y3/DR/DI were recognised: the terminal approved offline,
 *    printed its slip, and the POS showed a red DECLINED card.
 *  - Calling a decline an "approval" creates a receipt and deducts stock for a
 *    sale that never happened → goods out the door for free.
 *
 * Every expectation below cites `docs/edc/sdk-js/GUIDELINE.md` §5/§6.
 */
import { describe, expect, it } from "vitest";
import { classifyEdcResponse, isNonStandardApproval } from "./edcResponseCodes";

describe("classifyEdcResponse — money is committed", () => {
    it("treats 00 as approved (both protocols)", () => {
        expect(classifyEdcResponse("00")).toBe("approved");
    });

    it("treats VTI offline approvals Y1/Y3 as approved", () => {
        // §5: "Offline approved — Settlement will clear it". The terminal has
        // already printed a slip; the customer WILL be charged.
        expect(classifyEdcResponse("Y1")).toBe("approved");
        expect(classifyEdcResponse("Y3")).toBe("approved");
    });

    it("treats duplicate-reference echoes DR/DI as approved", () => {
        // §5 DR: "The prior result already applies — treat as success".
        // §5 DI: "Return prior result as success".
        // §6: these are what you get when a request is retried with the same
        // idempotency key, i.e. the original transaction did go through.
        expect(classifyEdcResponse("DR")).toBe("approved");
        expect(classifyEdcResponse("DI")).toBe("approved");
    });
});

describe("classifyEdcResponse — offline DECLINED must not be confused with offline approved", () => {
    it("treats Z1/Z3 as declined", () => {
        // §5: Z1/Z3 = "Offline declined". One character away from Y1/Y3 and the
        // opposite meaning — the pairing is the whole reason this test exists.
        expect(classifyEdcResponse("Z1")).toBe("declined");
        expect(classifyEdcResponse("Z3")).toBe("declined");
    });
});

describe("classifyEdcResponse — cancelled at the terminal", () => {
    it("treats UC/CN/XC as cancelled, not declined", () => {
        // Bounces back to the payment-choice screen rather than showing a
        // decline card, since nothing went wrong and nothing was charged.
        expect(classifyEdcResponse("UC")).toBe("cancelled");
        expect(classifyEdcResponse("CN")).toBe("cancelled");
        expect(classifyEdcResponse("XC")).toBe("cancelled");
    });
});

describe("classifyEdcResponse — genuine declines", () => {
    it("treats the issuer decline family and error codes as declined", () => {
        for (const code of ["01", "05", "51", "96", "ND", "EN", "TO", "NE", "PT", "ER", "EA", "CE", "LE", "NS"]) {
            expect(classifyEdcResponse(code)).toBe("declined");
        }
    });

    it("defaults unknown codes to declined", () => {
        // Safe direction: a decline takes no money-affecting action, while a
        // wrong "approved" would create a receipt and deduct stock.
        for (const code of ["ZZ", "", "  ", "999", "null"]) {
            expect(classifyEdcResponse(code)).toBe("declined");
        }
        expect(classifyEdcResponse(null)).toBe("declined");
        expect(classifyEdcResponse(undefined)).toBe("declined");
    });
});

describe("classifyEdcResponse — input normalisation", () => {
    it("ignores case and surrounding whitespace", () => {
        // The bridge is a third party; don't let " y1 " become a double charge.
        expect(classifyEdcResponse("y1")).toBe("approved");
        expect(classifyEdcResponse(" Y1 ")).toBe("approved");
        expect(classifyEdcResponse("dr")).toBe("approved");
        expect(classifyEdcResponse("uc")).toBe("cancelled");
    });

    it("does not match on partial or padded codes", () => {
        expect(classifyEdcResponse("000")).toBe("declined");
        expect(classifyEdcResponse("0")).toBe("declined");
        expect(classifyEdcResponse("Y10")).toBe("declined");
    });
});

describe("isNonStandardApproval", () => {
    it("is true only for approvals that are not a plain 00", () => {
        expect(isNonStandardApproval("00")).toBe(false);
        for (const code of ["Y1", "Y3", "DR", "DI"]) {
            expect(isNonStandardApproval(code)).toBe(true);
        }
    });

    it("is false for declines and cancellations", () => {
        for (const code of ["05", "Z1", "UC", "ZZ", "", null, undefined]) {
            expect(isNonStandardApproval(code)).toBe(false);
        }
    });
});
