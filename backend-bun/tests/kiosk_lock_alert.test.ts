import { describe, expect, test } from "bun:test";
import { buildKioskLockedAlertContent } from "@/services/kiosk_monitoring_service";

describe("buildKioskLockedAlertContent", () => {
    test("produces English subject and transaction details", () => {
        const { subject, html } = buildKioskLockedAlertContent(
            { fullName: "Kiosk 1", username: "kiosk1" },
            {
                ref: "9f513f73-4fb9-4864-ad40-34ac6253bcee",
                method: "CASH",
                payer_id: "202387",
                receiver_id: "202387",
                actual_amount: 1000,
                target_amount: 1000,
                locked_at: "2026-08-19T03:43:00.000Z",
            },
        );

        expect(subject).toContain("Kiosk locked");
        expect(subject).toContain("Kiosk 1");
        expect(subject).toContain("kiosk1");
        expect(html).toContain("Out of Service");
        expect(html).toContain("wallet was not credited");
        expect(html).toContain("9f513f73-4fb9-4864-ad40-34ac6253bcee");
        expect(html).toContain("202387");
        expect(html).toContain("1000.00 THB");
        expect(html).toContain("Bangkok time");
        expect(html).toContain("technician unlocks");
    });
});
