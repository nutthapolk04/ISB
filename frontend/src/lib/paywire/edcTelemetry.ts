/**
 * Ships what the EDC terminal told us to the server, so an incident is
 * investigable from the backend instead of only from the cashier's own machine.
 *
 * Why: on 2026-08-06 a debit-card sale was approved (terminal printed its slip)
 * but the POS never called /pos/checkout, because EdcPaymentModal only calls it
 * when the bridge returns a non-empty approval code — and none came back. The
 * bridge talks to the terminal over localhost, so that entire exchange left no
 * server-side trace: no receipt, no stock movement, no log line. This module
 * closes that hole.
 *
 * Three rules, all load-bearing:
 *
 *  1. **Log before branching.** The caller reports the result the moment it
 *     arrives, before deciding whether to confirm. The silent path is exactly
 *     the one that needs recording.
 *  2. **Never block or throw.** A sale must not fail because telemetry did.
 *     Every entry point returns void and swallows everything.
 *  3. **Queue when offline.** The POS station's network is a suspect in its own
 *     right, so a failed send is persisted and retried later rather than lost.
 *
 * PCI: the terminal's raw field bag is genuinely needed (the approval code
 * arrives under different keys per protocol, and finding the right key is the
 * open question), but card data must never leave this machine. Values shaped
 * like a card number and keys that can hold track/PIN material are stripped
 * here, before the request is built. The backend repeats the scrub.
 */
import { api } from "@/lib/api";

const QUEUE_KEY = "edc_telemetry_queue_v1";
/** Keep the queue bounded — this is diagnostics, not an audit ledger. Oldest
 *  entries are dropped first if a station stays offline for a long time. */
const QUEUE_MAX = 50;

/** Keys that can carry magstripe/chip/PIN material. Matched as a
 *  case-insensitive substring so `track2`, `TRACK_2`, `emv_tags` all hit. */
const SENSITIVE_KEY_PARTS = [
    "track", "pin", "pan", "cvv", "cvc", "cardno", "card_no", "cardnumber",
    "card_number", "emv", "iccdata", "icc_data", "dukpt", "ksn",
];

/** 13–19 digits, optionally split by spaces or dashes. A masked card
 *  ("****8433") has too few digits to match, so it survives intact. */
const PAN_LIKE_RE = /\b(?:\d[ -]?){13,19}\b/g;

const MAX_FIELDS = 80;
const MAX_VALUE_LEN = 512;

export const REDACTED = "[redacted]";

function isSensitiveKey(key: string): boolean {
    const k = key.toLowerCase();
    return SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}

/** Scrub a bridge field bag: keep every key (that's the point), clean values. */
export function sanitiseEdcFields(
    input: Record<string, string> | null | undefined,
): Record<string, string> | undefined {
    if (!input || typeof input !== "object") return undefined;
    const out: Record<string, string> = {};
    let kept = 0;
    for (const [key, value] of Object.entries(input)) {
        if (kept >= MAX_FIELDS) break;
        if (!key) continue;
        out[key] = isSensitiveKey(key)
            ? REDACTED
            : String(value ?? "").replace(PAN_LIKE_RE, REDACTED).slice(0, MAX_VALUE_LEN);
        kept += 1;
    }
    return out;
}

/** Scrub free text that may quote a raw bridge payload. */
export function sanitiseEdcText(value: string | null | undefined): string | undefined {
    if (value == null) return undefined;
    const cleaned = String(value).replace(PAN_LIKE_RE, REDACTED).trim();
    return cleaned ? cleaned.slice(0, 2000) : undefined;
}

// ── Payload ───────────────────────────────────────────────────────────────

export interface EdcEventPayload {
    event: "started" | "result" | "error";
    /** Which screen produced it — store_pos / canteen_pos / cashier_topup. */
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
    fields?: Record<string, string>;
    /** Cart contents, sent only with `started` — see EdcPaymentModal. */
    cart_snapshot?: unknown;
    /** False when the POS is about to give up without calling checkout — the
     *  discriminator that was missing during the incident. */
    checkout_attempted?: boolean;
    client_error?: string | null;
    client_at?: string;
}

// ── Offline queue ─────────────────────────────────────────────────────────

function readQueue(): EdcEventPayload[] {
    try {
        const raw = localStorage.getItem(QUEUE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as EdcEventPayload[]) : [];
    } catch {
        // Corrupt or unavailable storage — start clean rather than throwing
        // inside a telemetry path.
        return [];
    }
}

function writeQueue(items: EdcEventPayload[]): void {
    try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-QUEUE_MAX)));
    } catch {
        // Quota or private mode — dropping telemetry is acceptable, breaking a
        // sale is not.
    }
}

function enqueue(payload: EdcEventPayload): void {
    writeQueue([...readQueue(), payload]);
}

let flushing = false;

/**
 * Try to drain the queue. Stops at the first failure and puts the remainder
 * back, so ordering is preserved and a still-down network doesn't spin.
 */
export async function flushEdcTelemetry(): Promise<void> {
    if (flushing) return;
    const queued = readQueue();
    if (queued.length === 0) return;
    flushing = true;
    try {
        // Clear up front so a concurrent enqueue during the sends isn't lost to
        // the write-back below; anything undelivered is restored afterwards.
        writeQueue([]);
        const pending = [...queued];
        while (pending.length > 0) {
            const next = pending[0];
            try {
                await api.post("/pos/edc-events", next);
                pending.shift();
            } catch {
                break;
            }
        }
        if (pending.length > 0) writeQueue([...pending, ...readQueue()]);
    } catch {
        // Never propagate.
    } finally {
        flushing = false;
    }
}

// ── Entry point ───────────────────────────────────────────────────────────

/**
 * Record one EDC event. Fire-and-forget by contract: callers must NOT await
 * this, and it never rejects.
 */
export function logEdcEvent(payload: EdcEventPayload): void {
    const body: EdcEventPayload = {
        ...payload,
        client_at: payload.client_at ?? new Date().toISOString(),
        fields: sanitiseEdcFields(payload.fields),
        response_message: sanitiseEdcText(payload.response_message) ?? null,
        client_error: sanitiseEdcText(payload.client_error) ?? null,
    };

    void (async () => {
        try {
            await api.post("/pos/edc-events", body);
            // Piggyback the drain on a known-good connection instead of running
            // a timer that wakes an idle POS station.
            void flushEdcTelemetry();
        } catch {
            enqueue(body);
        }
    })();
}

// ── Recovery triggers ─────────────────────────────────────────────────────

/**
 * Drain on page load and whenever the browser regains connectivity.
 *
 * Without these the queue only moves on the *next* successful send, so a
 * station that went offline during its last EDC sale of the day would keep that
 * row — a record of a real terminal charge — sitting in localStorage until
 * someone happened to run another EDC transaction.
 *
 * Both triggers are best-effort: flushEdcTelemetry() never throws, and a flush
 * before login simply fails on the first item and puts everything back.
 */
if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
        void flushEdcTelemetry();
    });
    // Deferred so this never competes with first paint on a POS station.
    setTimeout(() => {
        void flushEdcTelemetry();
    }, 5_000);
}
