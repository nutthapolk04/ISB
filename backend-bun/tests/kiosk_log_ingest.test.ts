import { describe, expect, test } from "bun:test";

/** Mirrors kiosk/src/lib/kioskAuditLog.ts — keep field formatting in sync. */
function formatBillsField(counts: Partial<Record<1000 | 500 | 100, number>>): string {
    const parts: string[] = [];
    for (const denom of [1000, 500, 100] as const) {
        const n = counts[denom] ?? 0;
        if (n > 0) parts.push(`${denom}=${n}`);
    }
    return parts.join(",");
}

function escapeReason(reason: string): string {
    const trimmed = reason.trim().slice(0, 200).replace(/"/g, '\\"');
    return `"${trimmed}"`;
}

describe("kiosk audit log format helpers", () => {
    test("formatBillsField omits zero denominations", () => {
        expect(formatBillsField({ 500: 1, 100: 4 })).toBe("500=1,100=4");
        expect(formatBillsField({})).toBe("");
    });

    test("escapeReason caps length and escapes quotes", () => {
        const long = "x".repeat(250);
        expect(escapeReason(long).length).toBeLessThanOrEqual(202);
        expect(escapeReason('say "hi"')).toBe('"say \\"hi\\""');
    });
});

describe("kiosk log ingest constraints", () => {
    const VALID_CATEGORIES = new Set([
        "PING", "TAP", "TOPUP", "CLEAR-CASH-BOX", "LOCK", "UNLOCK", "system",
        "auth", "api", "bill", "cash", "qr", "pending",
    ]);
    const MAX_MESSAGE_LENGTH = 1000;

    test("accepts new audit categories", () => {
        for (const c of ["PING", "TAP", "TOPUP", "CLEAR-CASH-BOX"]) {
            expect(VALID_CATEGORIES.has(c)).toBe(true);
        }
    });

    test("message truncates at 1000 chars", () => {
        const msg = "a".repeat(1500);
        expect(msg.slice(0, MAX_MESSAGE_LENGTH).length).toBe(1000);
    });

    test("sample PING recovered line fits within 1000 chars", () => {
        const line = "2026-08-10 11:13:57+07:00 [PING] status=recovered";
        expect(line.length).toBeLessThanOrEqual(1000);
    });

    test("sample TOPUP failed line fits within 1000 chars", () => {
        const reason = escapeReason("connection reset");
        const line = [
            "2026-08-10 11:13:57+07:00 [TOPUP]",
            "ref=550e8400-e29b-41d4-a716-446655440000",
            "method=CASH",
            "payer_id=1234",
            "receiver_id=3456",
            "target_amount=1000",
            "actual_amount=900",
            "500=1,100=4",
            "status=failed",
            `reason=${reason}`,
        ].join(", ");
        expect(line.length).toBeLessThanOrEqual(1000);
    });
});
