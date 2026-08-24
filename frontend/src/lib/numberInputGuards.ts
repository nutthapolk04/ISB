/**
 * Guard for `<input type="number">` amount fields.
 *
 * A focused number input changes its own value when the mouse wheel scrolls
 * over it — standard browser behaviour, not a bug we introduced, and silent.
 * On a POS that is a money bug: reported 2026-08, a cashier took ฿1,000 cash,
 * typed 1000 into the top-up field (which carries `autoFocus`), and the wallet
 * was credited ฿995 — five wheel notches down — with the printed receipt
 * faithfully showing 995 because every layer below the input passes the amount
 * through untouched. The drawer held 1,000; the customer got 995.
 *
 * Blur rather than preventDefault: React registers `wheel` as a passive
 * listener on the root container, so `e.preventDefault()` inside onWheel is
 * ignored (and warns). Blurring drops focus, which is exactly what stops the
 * browser applying the delta, and leaves the page free to scroll normally.
 */

/** Attach as `onWheel` on a numeric input whose value must never drift. */
export function blurOnWheel(e: { currentTarget?: { blur?: () => void } | null }): void {
    e.currentTarget?.blur?.();
}
