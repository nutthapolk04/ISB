/**
 * The confirmation dialog exists to catch human error before cash changes
 * hands, so the figures on it must never be presented as current when they
 * aren't. These pin that.
 */
import { describe, expect, it } from "vitest";
import { topupConfirmFigures } from "./cashierTopupHelpers";

describe("topupConfirmFigures", () => {
    it("uses the freshly re-read balance and projects from it", () => {
        expect(topupConfirmFigures({
            amount: 1000, fetchedBalance: 9, cachedBalance: 9, hasWallet: true,
        })).toEqual({ balanceBefore: 9, balanceAfter: 1009, stale: false });
    });

    it("prefers the fresh read over a cached figure that has drifted", () => {
        // The customer spent 200 between lookup and confirm. Showing the cached
        // 500 would have the cashier verify against a number the wallet no
        // longer holds.
        expect(topupConfirmFigures({
            amount: 100, fetchedBalance: 300, cachedBalance: 500, hasWallet: true,
        })).toEqual({ balanceBefore: 300, balanceAfter: 400, stale: false });
    });

    it("falls back to the cached figure and flags it when the re-read fails", () => {
        expect(topupConfirmFigures({
            amount: 100, fetchedBalance: null, cachedBalance: 500, hasWallet: true,
        })).toEqual({ balanceBefore: 500, balanceAfter: 600, stale: true });
    });

    it("reports zero — not stale — for a customer whose wallet this creates", () => {
        // There is nothing to read, so nothing can be out of date.
        expect(topupConfirmFigures({
            amount: 500, fetchedBalance: null, cachedBalance: undefined, hasWallet: false,
        })).toEqual({ balanceBefore: 0, balanceAfter: 500, stale: false });
        // Even a cached figure is ignored: without a wallet it cannot be real.
        expect(topupConfirmFigures({
            amount: 500, fetchedBalance: null, cachedBalance: 42, hasWallet: false,
        })).toEqual({ balanceBefore: 0, balanceAfter: 500, stale: false });
    });

    it("treats a missing cached balance as zero, still flagged", () => {
        expect(topupConfirmFigures({
            amount: 100, fetchedBalance: null, cachedBalance: null, hasWallet: true,
        })).toEqual({ balanceBefore: 0, balanceAfter: 100, stale: true });
        expect(topupConfirmFigures({
            amount: 100, fetchedBalance: null, cachedBalance: undefined, hasWallet: true,
        })).toEqual({ balanceBefore: 0, balanceAfter: 100, stale: true });
    });

    it("keeps a genuine zero balance distinct from a failed read", () => {
        // fetchedBalance = 0 is a real answer, not an absence — the old
        // `?? cached` shape would have swallowed it.
        expect(topupConfirmFigures({
            amount: 100, fetchedBalance: 0, cachedBalance: 999, hasWallet: true,
        })).toEqual({ balanceBefore: 0, balanceAfter: 100, stale: false });
    });

    it("carries a negative balance through rather than clamping it", () => {
        // Overdraft is legitimate for some wallets; the dialog must show what
        // the wallet really holds so the cashier sees the top-up covers it.
        expect(topupConfirmFigures({
            amount: 300, fetchedBalance: -50, cachedBalance: -50, hasWallet: true,
        })).toEqual({ balanceBefore: -50, balanceAfter: 250, stale: false });
    });
});
