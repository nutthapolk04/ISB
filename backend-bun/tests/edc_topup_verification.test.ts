/**
 * EDC wallet topup verification — field validation only.
 *
 * Full Paywire gateway verification tests require mocking at the module level.
 * These tests focus on validating:
 * - EDC field format validation
 * - Approval code requirement
 * - Terminal ref / masked card optionality
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { edcTopup } from "@/services/topup_service";

beforeAll(() => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    }
});

describe("EDC Topup Verification", () => {
    describe("EDC field validation", () => {
        it("requires non-empty approval code", async () => {
            await expect(
                edcTopup({
                    walletId: 1,
                    amount: 1000,
                    userId: 1,
                    approvalCode: "",  // Empty
                    terminalRef: null,
                    maskedCard: null,
                    mode: "card",
                    notes: null,
                })
            ).rejects.toThrow("EDC approval code is required");
        });

        it("rejects approval code that's too short", async () => {
            await expect(
                edcTopup({
                    walletId: 1,
                    amount: 1000,
                    userId: 1,
                    approvalCode: "AB",  // Too short
                    terminalRef: "POS-001",
                    maskedCard: "****1234",
                    mode: "card",
                    notes: null,
                })
            ).rejects.toThrow("Invalid EDC approval code format");
        });

        it("rejects malformed masked card", async () => {
            await expect(
                edcTopup({
                    walletId: 1,
                    amount: 1000,
                    userId: 1,
                    approvalCode: "ABC123DEF456",
                    terminalRef: "POS-001",
                    maskedCard: "1234",  // Invalid: must be ****XXXX
                    mode: "card",
                    notes: null,
                })
            ).rejects.toThrow("Invalid EDC masked card format");
        });

        it("rejects malformed terminal ref", async () => {
            await expect(
                edcTopup({
                    walletId: 1,
                    amount: 1000,
                    userId: 1,
                    approvalCode: "ABC123DEF456",
                    terminalRef: "invalid@ref$$$",  // Invalid characters
                    maskedCard: "****1234",
                    mode: "card",
                    notes: null,
                })
            ).rejects.toThrow("Invalid EDC terminal reference format");
        });

        it("accepts valid EDC approval codes", async () => {
            // Valid format: 6-50 alphanumeric uppercase
            const validCodes = [
                "ABCDEF",       // 6 chars (minimum)
                "ABC123",       // 6 chars with numbers
                "A" + "B".repeat(49),  // 50 chars (maximum)
            ];

            for (const code of validCodes) {
                // These will fail on Paywire verification, but should pass format check
                // (or wallet not found, etc.) not on approval code format
                const error = await edcTopup({
                    walletId: 999999,
                    amount: 1000,
                    userId: 1,
                    approvalCode: code,
                    terminalRef: "POS-001",
                    maskedCard: "****1234",
                    mode: "card",
                    notes: null,
                }).catch(e => e);

                // Should not complain about approval code format
                expect(error.message).not.toMatch(/Invalid EDC approval code format/);
            }
        });

        it("accepts null terminal ref and masked card (optional fields)", async () => {
            // These fields are optional. The error should be from Paywire verification,
            // not from field validation
            const error = await edcTopup({
                walletId: 999999,
                amount: 1000,
                userId: 1,
                approvalCode: "ABC123DEF",
                terminalRef: null,   // Optional
                maskedCard: null,    // Optional
                mode: "card",
                notes: null,
            }).catch(e => e);

            // Should not complain about the null fields
            expect(error.message).not.toMatch(/terminal/i);
            expect(error.message).not.toMatch(/card/i);
        });
    });

    describe("Paywire API configuration", () => {
        it("rejects topup when PAYWIRE_API_KEY is not configured", async () => {
            // With no API key configured, edcTopup should reject
            await expect(
                edcTopup({
                    walletId: 1,
                    amount: 1000,
                    userId: 1,
                    approvalCode: "ABC123DEF",
                    terminalRef: "POS-001",
                    maskedCard: "****1234",
                    mode: "card",
                    notes: null,
                })
            ).rejects.toThrow("EDC approval code verification failed");
        });
    });
});
