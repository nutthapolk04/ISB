/**
 * openCustomerDisplayWindow — single source of truth for popping the
 * /customer-display route into a separate browser window.
 *
 * Uses a fixed window name ("isb-customer-display") so calling this twice
 * just re-focuses the same window instead of spawning duplicates — the
 * cashier can keep clicking "Open Customer Display" without filling the
 * desktop with stacked clones.
 *
 * Browsers only honour popups triggered by a user gesture (the login
 * button click, the toolbar button click). The first time the auto-open
 * runs from inside a fetch/await chain the popup may be blocked; the
 * recover button on the POS header lets the cashier reopen manually.
 *
 * Returns true if a window was opened (or focused), false if blocked.
 */
const WINDOW_NAME = "isb-customer-display";
const WINDOW_FEATURES =
  "popup=yes,noopener=no,width=1280,height=800,left=200,top=100";

export function openCustomerDisplayWindow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const w = window.open("/customer-display", WINDOW_NAME, WINDOW_FEATURES);
    if (!w) return false;
    // Focus the window so it surfaces over the cashier's main window when
    // re-opened from the toolbar button.
    try {
      w.focus();
    } catch {
      /* cross-origin or detached — ignore */
    }
    return true;
  } catch {
    return false;
  }
}
