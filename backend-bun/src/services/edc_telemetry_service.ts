/**
 * EDC bridge telemetry — server-side sink for what the terminal told the POS.
 *
 * Background (2026-08-06 incident): a debit-card sale was approved at the
 * terminal, which printed its slip, but the web POS never showed success and
 * nothing was recorded — no receipt, no stock movement. Investigation found the
 * POS had never called /pos/checkout at all: EdcPaymentModal only calls it when
 * the bridge returns a non-empty approval code, and none came back, so the
 * modal dead-ended on its "APPROVED — NOT RECORDED" screen. Because the bridge
 * runs on the cashier's own machine over localhost, that whole exchange left no
 * server-side trace and could only be reconstructed from the cashier's browser.
 *
 * This service accepts one row per observed terminal result (or bridge error),
 * written by the browser BEFORE it branches on the approval code, so the silent
 * path is recorded too. It is deliberately dumb: validate, sanitise, insert.
 * Nothing in the sale path reads it, and a failure here must never affect a
 * sale — the caller treats it as best-effort.
 *
 * PCI: `fields` is the bridge's raw field bag and is genuinely needed, because
 * the approval code arrives under different keys per protocol (LinkPOS's
 * `approval_code` vs VTI numeric fields) and identifying the right key is the
 * open question this telemetry exists to answer. The browser strips
 * card-number-shaped values and known track/PIN keys before sending;
 * sanitiseFields() below repeats that server-side so a stale or tampered client
 * can't land a PAN in the database.
 */
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { edcTxnEvents } from "@/db/schema";
import { pgNumber, pgToIso } from "@/lib/dates";
import { logger } from "@/logger";

// ── Sanitisation ──────────────────────────────────────────────────────────

/** Field keys that can carry magstripe/chip/PIN material. Dropped outright —
 *  none of them help identify an approval code. Matched case-insensitively as
 *  a substring so `track2`, `TRACK_2` and `emv_tags` are all covered. */
const SENSITIVE_KEY_PARTS = [
    "track", "pin", "pan", "cvv", "cvc", "cardno", "card_no", "cardnumber",
    "card_number", "emv", "iccdata", "icc_data", "dukpt", "ksn",
];

/** A digit run long enough to be a card number (13–19 digits, optionally split
 *  by spaces or dashes). Masked cards like "****8433" don't match — too few
 *  digits — so legitimately useful values survive. */
const PAN_LIKE_RE = /\b(?:\d[ -]?){13,19}\b/g;

/** Caps: one bridge reply is a few dozen short fields. These exist so a broken
 *  or hostile client can't turn an append-only log into a storage problem. */
const MAX_FIELDS = 80;
const MAX_KEY_LEN = 64;
const MAX_VALUE_LEN = 512;

export const REDACTED = "[redacted]";

function isSensitiveKey(key: string): boolean {
    const k = key.toLowerCase();
    return SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}

/**
 * Second-pass sanitiser for the raw field bag. Keys are kept (that's the point
 * — we're hunting for which key holds the approval code); values are what get
 * scrubbed and truncated.
 */
export function sanitiseFields(input: unknown): Record<string, string> | null {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const out: Record<string, string> = {};
    let kept = 0;
    for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
        if (kept >= MAX_FIELDS) break;
        const key = rawKey.slice(0, MAX_KEY_LEN);
        if (!key) continue;
        if (isSensitiveKey(key)) {
            out[key] = REDACTED;
            kept += 1;
            continue;
        }
        // Only scalars — a nested object in a bridge field bag is unexpected
        // and not worth walking; record its shape and move on.
        const value =
            rawValue == null
                ? ""
                : typeof rawValue === "object"
                    ? "[object]"
                    : String(rawValue);
        out[key] = value.replace(PAN_LIKE_RE, REDACTED).slice(0, MAX_VALUE_LEN);
        kept += 1;
    }
    return out;
}

/** Same scrub for free-text columns, which can quote a bridge payload. */
export function sanitiseText(value: string | null | undefined, maxLen = 2000): string | null {
    if (value == null) return null;
    const cleaned = String(value).replace(PAN_LIKE_RE, REDACTED).trim();
    return cleaned ? cleaned.slice(0, maxLen) : null;
}

// ── Input ─────────────────────────────────────────────────────────────────

export type EdcTelemetryEvent = "started" | "result" | "error";

export interface RecordEdcEventInput {
    event: EdcTelemetryEvent;
    context: string;
    shop_id?: string | null;
    idempotency_key?: string | null;
    pos_ref?: string | null;
    edc_mode?: string | null;
    amount?: number | null;
    response_code?: string | null;
    response_message?: string | null;
    approval_code?: string | null;
    masked_card?: string | null;
    rrn?: string | null;
    fields?: unknown;
    checkout_attempted?: boolean | null;
    client_error?: string | null;
    client_at?: string | null;
    /** Resolved from the JWT by the controller — never trusted from the body. */
    cashierUserId: number | null;
}

/** Trim + clamp a short varchar column, collapsing "" to null. */
function short(value: string | null | undefined, maxLen: number): string | null {
    if (value == null) return null;
    const v = String(value).trim();
    return v ? v.slice(0, maxLen) : null;
}

// ── Write ─────────────────────────────────────────────────────────────────

export interface RecordEdcEventResult {
    id: number;
}

export async function recordEdcEvent(input: RecordEdcEventInput): Promise<RecordEdcEventResult> {
    const approvalCode = short(input.approval_code, 32);
    // The frontend's own gate is `approvalCode.trim().length > 0`; mirror it
    // exactly so this column always answers "would checkout have been called?"
    const hasApprovalCode = approvalCode !== null;

    const [row] = await db
        .insert(edcTxnEvents)
        .values({
            event: short(input.event, 20) ?? "result",
            context: short(input.context, 30) ?? "unknown",
            shopId: short(input.shop_id, 50),
            cashierUserId: input.cashierUserId,
            idempotencyKey: short(input.idempotency_key, 64),
            posRef: short(input.pos_ref, 64),
            edcMode: short(input.edc_mode, 10),
            amount: input.amount == null || !Number.isFinite(input.amount)
                ? null
                : String(Math.round(input.amount * 100) / 100),
            responseCode: short(input.response_code, 10),
            responseMessage: sanitiseText(input.response_message),
            approvalCode,
            hasApprovalCode,
            maskedCard: short(input.masked_card, 30),
            rrn: short(input.rrn, 64),
            fields: sanitiseFields(input.fields),
            checkoutAttempted: input.checkout_attempted === true,
            clientError: sanitiseText(input.client_error),
            clientAt: input.client_at ?? null,
        })
        .returning({ id: edcTxnEvents.id });

    // One structured line per event so this is greppable in the backend log
    // even before anyone builds a UI over the table — that alone would have
    // resolved the incident that prompted this.
    logger.info("[EDC] terminal event", {
        id: row.id,
        event: input.event,
        context: input.context,
        shopId: input.shop_id ?? null,
        cashierUserId: input.cashierUserId,
        responseCode: input.response_code ?? null,
        hasApprovalCode,
        checkoutAttempted: input.checkout_attempted === true,
        posRef: short(input.pos_ref, 64),
        idempotencyKey: short(input.idempotency_key, 64),
        amount: input.amount ?? null,
        // The whole point: which keys did the bridge actually send?
        fieldKeys: input.fields && typeof input.fields === "object" && !Array.isArray(input.fields)
            ? Object.keys(input.fields as Record<string, unknown>).slice(0, MAX_FIELDS)
            : [],
    });

    return { id: row.id };
}

// ── Read (investigation) ──────────────────────────────────────────────────

export interface EdcTxnEventDTO {
    id: number;
    event: string;
    context: string;
    shop_id: string | null;
    cashier_user_id: number | null;
    idempotency_key: string | null;
    pos_ref: string | null;
    edc_mode: string | null;
    amount: number | null;
    response_code: string | null;
    response_message: string | null;
    approval_code: string | null;
    has_approval_code: boolean;
    masked_card: string | null;
    rrn: string | null;
    fields: Record<string, string> | null;
    checkout_attempted: boolean;
    client_error: string | null;
    client_at: string | null;
    created_at: string;
}

export interface ListEdcEventsArgs {
    dateFrom?: string | null;
    dateToExclusive?: string | null;
    shopId?: string | null;
    /** Only rows the terminal approved that the POS never sent to checkout —
     *  the incident shape. */
    unrecordedOnly?: boolean;
    limit?: number;
}

export async function listEdcEvents(args: ListEdcEventsArgs = {}): Promise<EdcTxnEventDTO[]> {
    const conds = [];
    if (args.dateFrom) conds.push(gte(edcTxnEvents.createdAt, args.dateFrom));
    if (args.dateToExclusive) conds.push(lt(edcTxnEvents.createdAt, args.dateToExclusive));
    if (args.shopId) conds.push(eq(edcTxnEvents.shopId, args.shopId));
    if (args.unrecordedOnly) {
        conds.push(eq(edcTxnEvents.responseCode, "00"));
        conds.push(eq(edcTxnEvents.checkoutAttempted, false));
    }

    const rows = await db
        .select()
        .from(edcTxnEvents)
        .where(conds.length > 0 ? and(...conds) : sql`true`)
        .orderBy(desc(edcTxnEvents.createdAt), desc(edcTxnEvents.id))
        .limit(Math.min(Math.max(args.limit ?? 200, 1), 1000));

    return rows.map((r) => ({
        id: r.id,
        event: r.event,
        context: r.context,
        shop_id: r.shopId ?? null,
        cashier_user_id: r.cashierUserId ?? null,
        idempotency_key: r.idempotencyKey ?? null,
        pos_ref: r.posRef ?? null,
        edc_mode: r.edcMode ?? null,
        amount: pgNumber(r.amount),
        response_code: r.responseCode ?? null,
        response_message: r.responseMessage ?? null,
        approval_code: r.approvalCode ?? null,
        has_approval_code: r.hasApprovalCode,
        masked_card: r.maskedCard ?? null,
        rrn: r.rrn ?? null,
        fields: (r.fields as Record<string, string> | null) ?? null,
        checkout_attempted: r.checkoutAttempted,
        client_error: r.clientError ?? null,
        client_at: pgToIso(r.clientAt),
        created_at: pgToIso(r.createdAt)!,
    }));
}
