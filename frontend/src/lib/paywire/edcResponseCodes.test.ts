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
import {
    classifyEdcResponse,
    isNonStandardApproval,
    posRefFromIdempotencyKey,
} from "./edcResponseCodes";

describe("posRefFromIdempotencyKey", () => {
    it("reproduces the POS reference the bridge actually used in production", () => {
        // Captured 2026-08-06 from a real terminal: the bridge echoed
        // pos_ref_no "d31c1a4bc30749859292" for this idempotency key. If this
        // derivation drifts, QUERY recovery silently targets a reference the
        // terminal has never heard of, and the slip can no longer be matched to
        // a telemetry row.
        expect(posRefFromIdempotencyKey("d31c1a4b-c307-4985-9292-00618832257e"))
            .toBe("d31c1a4bc30749859292");
    });

    it("is always 20 characters and hex-only for a UUID input", () => {
        for (let i = 0; i < 20; i += 1) {
            const ref = posRefFromIdempotencyKey(crypto.randomUUID());
            expect(ref).toHaveLength(20);
            expect(ref).toMatch(/^[0-9a-f]{20}$/);
        }
    });

    it("round-trips the POS REF printed on the 2026-08-06 slip", () => {
        // The failing slip showed POS REF. NO 56d032721d234111a011. Any key
        // whose first 20 hex characters match must resolve to it, which is what
        // makes "find the telemetry row for this paper slip" possible.
        expect(posRefFromIdempotencyKey("56d03272-1d23-4111-a011-000000000000"))
            .toBe("56d032721d234111a011");
    });

    it("does not blow up on a short or dashless key", () => {
        expect(posRefFromIdempotencyKey("abc")).toBe("abc");
        expect(posRefFromIdempotencyKey("")).toBe("");
        expect(posRefFromIdempotencyKey("0123456789abcdef0123456789abcdef"))
            .toBe("0123456789abcdef0123");
    });
});

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

describe("classifyEdcResponse — QR timeout is NOT auto-classified as cancelled", () => {
    it("treats TO as declined regardless of sale mode", () => {
        // Confirmed 2026-08-07: cancelling a Thai QR sale from the terminal
        // before the customer scans also comes back as TO, not UC/CN/XC — but
        // this classifier has no way to tell that apart from an ordinary
        // network timeout that fires before the terminal's own ~3-minute QR
        // window ends (nothing here imposes a client-side deadline). Auto-
        // treating TO as "safe, nothing happened" would risk exactly the
        // "charged but not recorded" gap this module exists to prevent.
        // EdcPaymentModal handles QR + TO specially: it confirms via query()
        // before resetting to choice, rather than trusting the code alone.
        expect(classifyEdcResponse("TO")).toBe("declined");
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
