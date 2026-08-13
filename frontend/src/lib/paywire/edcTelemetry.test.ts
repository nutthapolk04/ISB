/**
 * Client-side EDC telemetry scrub.
 *
 * This is the real PCI boundary: card data must never leave the cashier's
 * machine. The backend scrubs again as defence in depth (see
 * backend-bun/tests/edc_telemetry.test.ts), but by then the data has already
 * crossed the network — so these cases are the ones that actually matter.
 *
 * The raw bridge field bag is sent on purpose: the approval code arrives under
 * different keys per protocol (LinkPOS `approval_code` vs VTI numeric fields),
 * and identifying the right key is the open question behind the 2026-08-06
 * incident. So keys are preserved and only values are scrubbed.
 */
import { describe, expect, it } from "vitest";
import { sanitiseEdcFields, sanitiseEdcText, REDACTED } from "./edcTelemetry";

describe("sanitiseEdcFields — card data never leaves the browser", () => {
    it("redacts PANs, plain and separated", () => {
        expect(sanitiseEdcFields({ a: "4111111111111111" })?.a).toBe(REDACTED);
        expect(sanitiseEdcFields({ a: "4111 1111 1111 1111" })?.a).toBe(REDACTED);
        expect(sanitiseEdcFields({ a: "4111-1111-1111-1111" })?.a).toBe(REDACTED);
    });

    it("redacts a PAN embedded in a message", () => {
        const out = sanitiseEdcFields({ msg: "APPROVED 4111111111111111 thanks" });
        expect(out?.msg).not.toContain("4111111111111111");
    });

    it("blanks track / PIN / EMV keys but keeps the key name visible", () => {
        const out = sanitiseEdcFields({ track2: "x", pinblock: "y", EMV_TAGS: "z" });
        expect(out).toEqual({ track2: REDACTED, pinblock: REDACTED, EMV_TAGS: REDACTED });
    });
});

describe("sanitiseEdcFields — the data we actually need survives", () => {
    it("keeps short identifiers, including VTI numeric field keys", () => {
        // "38" is the ISO-8583 auth-code field and a prime suspect for where the
        // approval code went missing — it must arrive at the server untouched.
        const out = sanitiseEdcFields({
            approval_code: "139350",
            "38": "139350",
            invoice_no: "000065",
            response_code: "00",
            payer_id: "****8433",
        });
        expect(out).toEqual({
            approval_code: "139350",
            "38": "139350",
            invoice_no: "000065",
            response_code: "00",
            payer_id: "****8433",
        });
    });

    it("returns undefined for a missing bag so the field is omitted from the body", () => {
        expect(sanitiseEdcFields(undefined)).toBeUndefined();
        expect(sanitiseEdcFields(null)).toBeUndefined();
    });

    it("caps field count and value length", () => {
        const big: Record<string, string> = {};
        for (let i = 0; i < 300; i += 1) big[`f${i}`] = "v";
        expect(Object.keys(sanitiseEdcFields(big) ?? {}).length).toBeLessThanOrEqual(80);
        expect(sanitiseEdcFields({ b: "a".repeat(4000) })?.b.length).toBeLessThanOrEqual(512);
    });
});

describe("sanitiseEdcText", () => {
    it("scrubs PANs and normalises blanks to undefined", () => {
        expect(sanitiseEdcText("failed on 4111111111111111")).toContain(REDACTED);
        expect(sanitiseEdcText("  ")).toBeUndefined();
        expect(sanitiseEdcText(null)).toBeUndefined();
        expect(sanitiseEdcText(undefined)).toBeUndefined();
    });

    it("leaves ordinary bridge errors readable", () => {
        expect(sanitiseEdcText("bridge unreachable")).toBe("bridge unreachable");
    });
});
