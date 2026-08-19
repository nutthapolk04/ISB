/** Cash confirm screen idle timeout — visible countdown + grace for in-flight bills. */
export const CASH_IDLE_DISPLAY_SEC = 15;
export const CASH_IDLE_TOTAL_SEC = 20;
export const CASH_IDLE_GRACE_SEC = CASH_IDLE_TOTAL_SEC - CASH_IDLE_DISPLAY_SEC;

/** Visible seconds left on the UI (0 during the grace window). */
export function cashDisplayTime(timeLeftSec: number): number {
    return Math.max(0, timeLeftSec - CASH_IDLE_GRACE_SEC);
}

export function cashProgress(timeLeftSec: number): number {
    return cashDisplayTime(timeLeftSec) / CASH_IDLE_DISPLAY_SEC;
}

export type CashIdleExpiryAction = 'hold' | 'proceed';

/** When a bill is in escrow/stacking, defer idle expiry instead of cancelling/finalizing. */
export function resolveCashIdleExpiry(billInFlight: boolean): CashIdleExpiryAction {
    return billInFlight ? 'hold' : 'proceed';
}

/** Pause the countdown while hardware is processing a bill. */
export function shouldSkipIdleCountdownTick(billInFlight: boolean): boolean {
    return billInFlight;
}

/** Sentinel value — keeps the interval alive during the grace window. */
export function cashIdleHoldSeconds(): number {
    return 1;
}
