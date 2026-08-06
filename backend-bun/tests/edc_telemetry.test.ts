/**
 * EDC bridge telemetry — sanitisation and the incident-shaped query.
 *
 * Context: on 2026-08-06 a debit-card sale was approved at the terminal (slip
 * printed) but the POS never called /pos/checkout, because it only does so when
 * a non-empty approval code comes back and none did. The bridge runs on the
 * cashier's machine over localhost, so nothing reached the server: no receipt,
 * no stock movement, no log line. edc_txn_events is the fix.
 *
 * Two things must hold, forever:
 *   1. **No card data lands in the database.** The raw field bag is stored on
 *      purpose (we're hunting for which key carries the approval code), so the
 *      scrub is the only thing standing between a PAN and a permanent row.
 *   2. **The silent path is queryable.** `checkout_attempted = false` alongside
 *      `response_code = '00'` is the exact incident shape; if that stops being
 *      recorded faithfully this table is worthless.
 *
 * Conventions mirror adjustment_report.test.ts / transfer_report.test.ts — pure
 * cases run anywhere, DB cases are gated on a localhost DATABASE_URL and clean
 * up after themselves.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db, pingDb } from "@/db/client";
import { edcTxnEvents } from "@/db/schema";
import {
    recordEdcEvent,
    listEdcEvents,
    sanitiseFields,
    sanitiseText,
    REDACTED,
} from "@/services/edc_telemetry_service";

/**
 * Localhost-only, same reasoning as the other DB-backed suites: bun auto-loads
 * `backend-bun/.env`, which on this repo is routinely repointed at the shared
 * Railway instance, and these cases INSERT rows.
 */
const DB_URL = process.env.DATABASE_URL ?? "";
const IS_LOCAL_DB = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL);
const HAS_DB = !!DB_URL && IS_LOCAL_DB;
let dbOk = false;
const DB_TIMEOUT_MS = 45_000;

beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = "test-secret-not-for-prod-32chars!!";
    }
    if (DB_URL && !IS_LOCAL_DB) {
        console.warn(
            "[edc_telemetry] Skipping DB-backed cases: DATABASE_URL is not localhost. " +
            "These tests write fixture rows and must not run against a shared database.",
        );
    }
    if (HAS_DB) dbOk = await pingDb();
});

// ── Pure: PAN-shaped values must never survive ────────────────────────────

describe("sanitiseFields — card data", () => {
    it("redacts a 16-digit PAN", () => {
        const out = sanitiseFields({ some_field: "4111111111111111" });
        expect(out?.some_field).toBe(REDACTED);
    });

    it("redacts PANs written with spaces or dashes", () => {
        expect(sanitiseFields({ a: "4111 1111 1111 1111" })?.a).toBe(REDACTED);
        expect(sanitiseFields({ a: "4111-1111-1111-1111" })?.a).toBe(REDACTED);
    });

    it("redacts a 13-digit and a 19-digit number (range boundaries)", () => {
        expect(sanitiseFields({ a: "4111111111111" })?.a).toBe(REDACTED);
        expect(sanitiseFields({ a: "4111111111111111222" })?.a).toBe(REDACTED);
    });

    it("redacts a PAN embedded in a longer message", () => {
        const out = sanitiseFields({ msg: "APPROVED card 4111111111111111 ok" });
        expect(out?.msg).not.toContain("4111111111111111");
        expect(out?.msg).toContain(REDACTED);
    });

    it("keeps a masked card — too few digits to look like a PAN", () => {
        expect(sanitiseFields({ payer_id: "****8433" })?.payer_id).toBe("****8433");
    });

    it("keeps short numbers that matter: approval code, invoice, amount", () => {
        const out = sanitiseFields({
            approval_code: "139350",
            invoice_no: "000065",
            amount: "1252000",
            "38": "139350",
        });
        expect(out).toEqual({
            approval_code: "139350",
            invoice_no: "000065",
            amount: "1252000",
            "38": "139350",
        });
    });
});

describe("sanitiseFields — sensitive keys", () => {
    it("blanks track / PIN / EMV style keys regardless of case", () => {
        const out = sanitiseFields({
            track2: "x", TRACK_2: "x", pinblock: "x", emv_tags: "x",
            icc_data: "x", ksn: "x", cvv: "x", card_number: "x",
        });
        for (const v of Object.values(out ?? {})) expect(v).toBe(REDACTED);
    });

    it("keeps the key itself so we can still see what the bridge sent", () => {
        // The whole point of storing the bag is discovering which key holds the
        // approval code — dropping keys entirely would defeat that.
        expect(Object.keys(sanitiseFields({ track2: "x" }) ?? {})).toEqual(["track2"]);
    });

    it("does not blank an innocent key that merely contains a digit", () => {
        expect(sanitiseFields({ response_code: "00" })?.response_code).toBe("00");
    });
});

describe("sanitiseFields — shape and caps", () => {
    it("returns null for non-objects", () => {
        expect(sanitiseFields(null)).toBeNull();
        expect(sanitiseFields(undefined)).toBeNull();
        expect(sanitiseFields("nope")).toBeNull();
        expect(sanitiseFields([1, 2])).toBeNull();
    });

    it("caps the number of fields", () => {
        const big: Record<string, string> = {};
        for (let i = 0; i < 500; i += 1) big[`f${i}`] = "v";
        expect(Object.keys(sanitiseFields(big) ?? {}).length).toBeLessThanOrEqual(80);
    });

    it("truncates a very long value", () => {
        const out = sanitiseFields({ blob: "a".repeat(5000) });
        expect(out?.blob.length).toBeLessThanOrEqual(512);
    });

    it("coerces non-strings and notes nested objects rather than walking them", () => {
        const out = sanitiseFields({ n: 42, b: true, nested: { a: 1 } });
        expect(out?.n).toBe("42");
        expect(out?.b).toBe("true");
        expect(out?.nested).toBe("[object]");
    });
});

describe("sanitiseText", () => {
    it("redacts a PAN and collapses empty to null", () => {
        expect(sanitiseText("declined 4111111111111111")).toContain(REDACTED);
        expect(sanitiseText("   ")).toBeNull();
        expect(sanitiseText(null)).toBeNull();
        expect(sanitiseText(undefined)).toBeNull();
    });

    it("keeps ordinary error text intact", () => {
        expect(sanitiseText("bridge unreachable")).toBe("bridge unreachable");
    });
});

// ── DB-backed ─────────────────────────────────────────────────────────────

const TAG = `edc-${Date.now().toString(36)}`;

describe("recordEdcEvent (DB)", () => {
    it.if(HAS_DB)(
        "records the silent path: approved by the terminal, checkout never called",
        async () => {
            if (!dbOk) return;
            const ids: number[] = [];
            try {
                // This is the 2026-08-06 shape exactly: response 00, no approval
                // code, so EdcPaymentModal dead-ends without calling checkout.
                const { id } = await recordEdcEvent({
                    event: "result",
                    context: `store_pos`,
                    shop_id: TAG,
                    cashierUserId: null,
                    idempotency_key: `${TAG}-key`,
                    edc_mode: "card",
                    amount: 12520,
                    response_code: "00",
                    approval_code: null,
                    fields: { response_code: "00", invoice_no: "000065" },
                    checkout_attempted: false,
                });
                ids.push(id);

                const rows = await listEdcEvents({ shopId: TAG, unrecordedOnly: true });
                expect(rows).toHaveLength(1);
                expect(rows[0].id).toBe(id);
                expect(rows[0].has_approval_code).toBe(false);
                expect(rows[0].checkout_attempted).toBe(false);
                expect(rows[0].amount).toBe(12520);
                expect(rows[0].fields).toEqual({ response_code: "00", invoice_no: "000065" });
            } finally {
                if (ids.length) await db.delete(edcTxnEvents).where(inArray(edcTxnEvents.id, ids));
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "never stores a PAN even if the client sends one",
        async () => {
            if (!dbOk) return;
            // Defence in depth: the browser scrubs first, but a stale bundle or
            // a hand-rolled request must not be able to persist card data.
            const ids: number[] = [];
            try {
                const { id } = await recordEdcEvent({
                    event: "result",
                    context: "store_pos",
                    shop_id: TAG,
                    cashierUserId: null,
                    response_code: "00",
                    response_message: "approved 4111111111111111",
                    approval_code: "139350",
                    fields: { track2: "4111111111111111=2512", raw: "PAN 4111111111111111" },
                    checkout_attempted: true,
                });
                ids.push(id);

                const [row] = await db
                    .select()
                    .from(edcTxnEvents)
                    .where(eq(edcTxnEvents.id, id));
                const serialised = JSON.stringify(row);
                expect(serialised).not.toContain("4111111111111111");
                expect(row.approvalCode).toBe("139350");
                expect(row.hasApprovalCode).toBe(true);
            } finally {
                if (ids.length) await db.delete(edcTxnEvents).where(inArray(edcTxnEvents.id, ids));
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "derives has_approval_code with the same trim() rule the frontend gates on",
        async () => {
            if (!dbOk) return;
            const ids: number[] = [];
            try {
                // "   " must read as absent: the modal's gate is
                // `approvalCode.trim().length > 0`, so a whitespace-only code is
                // one that never reaches checkout.
                for (const [code, expected] of [
                    ["139350", true],
                    ["  139350  ", true],
                    ["   ", false],
                    ["", false],
                    [null, false],
                ] as Array<[string | null, boolean]>) {
                    const { id } = await recordEdcEvent({
                        event: "result",
                        context: "store_pos",
                        shop_id: TAG,
                        cashierUserId: null,
                        response_code: "00",
                        approval_code: code,
                        checkout_attempted: expected,
                    });
                    ids.push(id);
                    const [row] = await db.select().from(edcTxnEvents).where(eq(edcTxnEvents.id, id));
                    expect(row.hasApprovalCode).toBe(expected);
                    if (expected) expect(row.approvalCode).toBe("139350");
                    else expect(row.approvalCode).toBeNull();
                }
            } finally {
                if (ids.length) await db.delete(edcTxnEvents).where(inArray(edcTxnEvents.id, ids));
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "treats a missing checkout_attempted as false rather than null",
        async () => {
            if (!dbOk) return;
            // The column is NOT NULL and its whole job is to answer "did the POS
            // give up silently?" — defaulting to false keeps the unrecorded
            // filter honest when an older client omits the field.
            const ids: number[] = [];
            try {
                const { id } = await recordEdcEvent({
                    event: "error",
                    context: "store_pos",
                    shop_id: TAG,
                    cashierUserId: null,
                    client_error: "bridge unreachable",
                });
                ids.push(id);
                const [row] = await db.select().from(edcTxnEvents).where(eq(edcTxnEvents.id, id));
                expect(row.checkoutAttempted).toBe(false);
                expect(row.responseCode).toBeNull();
                expect(row.clientError).toBe("bridge unreachable");
            } finally {
                if (ids.length) await db.delete(edcTxnEvents).where(inArray(edcTxnEvents.id, ids));
            }
        },
        DB_TIMEOUT_MS,
    );

    it.if(HAS_DB)(
        "excludes declines and successful sales from the unrecorded filter",
        async () => {
            if (!dbOk) return;
            const ids: number[] = [];
            try {
                // A decline (response 05) is not an unreconciled charge, and an
                // approval that did reach checkout is not either. Only the
                // approved-but-never-sent row should surface.
                const decline = await recordEdcEvent({
                    event: "result", context: "store_pos", shop_id: TAG, cashierUserId: null,
                    response_code: "05", checkout_attempted: false,
                });
                const recorded = await recordEdcEvent({
                    event: "result", context: "store_pos", shop_id: TAG, cashierUserId: null,
                    response_code: "00", approval_code: "111111", checkout_attempted: true,
                });
                const silent = await recordEdcEvent({
                    event: "result", context: "store_pos", shop_id: TAG, cashierUserId: null,
                    response_code: "00", checkout_attempted: false,
                });
                ids.push(decline.id, recorded.id, silent.id);

                const unrecorded = await listEdcEvents({ shopId: TAG, unrecordedOnly: true });
                expect(unrecorded.map((r) => r.id)).toEqual([silent.id]);

                // Without the filter all three are visible, newest first.
                const all = await listEdcEvents({ shopId: TAG });
                expect(all).toHaveLength(3);
            } finally {
                if (ids.length) await db.delete(edcTxnEvents).where(inArray(edcTxnEvents.id, ids));
            }
        },
        DB_TIMEOUT_MS,
    );
});
