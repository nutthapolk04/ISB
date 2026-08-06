/**
 * Request timeout behaviour.
 *
 * Two properties matter here and both are money-safety properties:
 *
 *  1. **Opt-in only.** Reports, exports and sync calls in this app are
 *     legitimately slow. A global timeout would abort them, so a call that
 *     doesn't ask for one must behave exactly as before.
 *  2. **A timeout is NOT a failure.** The server may have processed the
 *     request; only the answer was lost. It therefore surfaces as its own
 *     error type, never as an ApiError with a status — because a caller that
 *     mistakes "unknown" for "declined" is a caller that charges the customer
 *     twice.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ApiError, RequestTimeoutError, api } from "./api";

const realFetch = globalThis.fetch;

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
});

/** A fetch that never settles until the caller's AbortSignal fires. */
function hangingFetch(): typeof globalThis.fetch {
    return vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) return; // hangs forever — the pre-timeout behaviour
            signal.addEventListener("abort", () => {
                reject(new DOMException("The operation was aborted.", "AbortError"));
            });
        });
    }) as unknown as typeof globalThis.fetch;
}

function jsonFetch(body: unknown, status = 200): typeof globalThis.fetch {
    return vi.fn(async () =>
        new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof globalThis.fetch;
}

describe("api.post — timeout opt-in", () => {
    it("rejects with RequestTimeoutError once the deadline passes", async () => {
        globalThis.fetch = hangingFetch();
        await expect(api.post("/pos/checkout", { a: 1 }, { timeoutMs: 30 }))
            .rejects.toBeInstanceOf(RequestTimeoutError);
    });

    it("does not present a timeout as an ApiError", async () => {
        // A caller doing `err instanceof ApiError` must NOT treat this as a
        // server rejection — the sale may have gone through.
        globalThis.fetch = hangingFetch();
        const err = await api.post("/pos/checkout", {}, { timeoutMs: 30 }).catch((e) => e);
        expect(err).toBeInstanceOf(RequestTimeoutError);
        expect(err).not.toBeInstanceOf(ApiError);
        expect((err as { status?: number }).status).toBeUndefined();
    });

    it("carries the path and the deadline for the log line", async () => {
        globalThis.fetch = hangingFetch();
        const err = (await api.post("/pos/checkout", {}, { timeoutMs: 25 }).catch((e) => e)) as RequestTimeoutError;
        expect(err.path).toContain("/pos/checkout");
        expect(err.timeoutMs).toBe(25);
    });

    it("passes no AbortSignal at all when no timeout was requested", async () => {
        // Guards the opt-in promise: an unrelated slow endpoint must keep the
        // exact behaviour it had before timeouts existed.
        const spy = vi.fn(async () => new Response("{}", { status: 200 }));
        globalThis.fetch = spy as unknown as typeof globalThis.fetch;
        await api.post("/reports/slow", {});
        const init = spy.mock.calls[0][1] as RequestInit | undefined;
        expect(init?.signal).toBeUndefined();
    });

    it("resolves normally when the response beats the deadline", async () => {
        globalThis.fetch = jsonFetch({ ok: true });
        await expect(api.post("/pos/checkout", {}, { timeoutMs: 5_000 }))
            .resolves.toEqual({ ok: true });
    });

    it("still surfaces server errors as ApiError when a timeout is set", async () => {
        globalThis.fetch = jsonFetch({ detail: "Insufficient stock" }, 400);
        const err = await api.post("/pos/checkout", {}, { timeoutMs: 5_000 }).catch((e) => e);
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(400);
    });
});
