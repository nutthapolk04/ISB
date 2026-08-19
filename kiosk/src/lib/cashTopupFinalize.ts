/**
 * Wallet credit for cash top-up must use the collected total **after** stopCollecting()
 * settles any in-flight escrow. Reading before stop() can under-credit when a second
 * bill is accepted but not yet stacked (e.g. target 2000 with two 1000 bills).
 */
export function resolveCashCreditAmount(collectedThbAfterStop: number): number {
    return collectedThbAfterStop;
}

/** Guard against double finalize (idle + collectComplete racing). */
export function shouldStartCashFinalize(alreadyStarted: boolean): boolean {
    return !alreadyStarted;
}
