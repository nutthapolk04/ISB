/**
 * Figures shown on the pre-submit top-up confirmation.
 *
 * Extracted because this is the part that can be wrong in a way a cashier
 * would trust: the dialog exists to catch human error, so presenting a stale
 * balance as current would replace one error class with another.
 *
 * `selectedCustomer.wallet_balance` is captured when the cashier looks the
 * customer up and drifts the moment that customer spends or another till tops
 * them up, so the dialog re-reads the wallet on open. A failed re-read falls
 * back to the cached figure and says so rather than silently presenting it as
 * current — the top-up AMOUNT needs no server call and is unaffected either
 * way, which is why a failed re-read must not block the sale.
 */
export interface TopupConfirmFigures {
    balanceBefore: number;
    balanceAfter: number;
    /** Balance came from the cached lookup, not a fresh read — warn the cashier. */
    stale: boolean;
}

export function topupConfirmFigures(args: {
    amount: number;
    /** Freshly re-read balance, or null if the read failed. */
    fetchedBalance: number | null;
    /** Captured at lookup time; may have drifted since. */
    cachedBalance: number | null | undefined;
    /** False when this top-up will create the wallet. */
    hasWallet: boolean;
}): TopupConfirmFigures {
    const { amount, fetchedBalance, cachedBalance, hasWallet } = args;

    // No wallet yet: it starts at zero by definition, so there is nothing to
    // read and nothing that could be stale.
    if (!hasWallet) {
        return { balanceBefore: 0, balanceAfter: amount, stale: false };
    }
    if (fetchedBalance !== null) {
        return { balanceBefore: fetchedBalance, balanceAfter: fetchedBalance + amount, stale: false };
    }
    const before = cachedBalance ?? 0;
    return { balanceBefore: before, balanceAfter: before + amount, stale: true };
}
