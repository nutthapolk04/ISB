/**
 * openCustomerDisplayWindow — single source of truth for popping the
 * /customer-display route into a separate browser window.
 *
 * Uses a fixed window name ("isb-customer-display") so calling this twice
 * just re-focuses the same window instead of spawning duplicates.
 *
 * Strategy:
 * 1. Try Window Management API (Chrome 100+) to place window on the second
 *    monitor automatically — requires a one-time browser permission grant.
 * 2. Fall back to a sensible default position on the primary screen.
 */
const WINDOW_NAME = "isb-customer-display";
const FALLBACK_FEATURES = "popup=yes,noopener=no,width=1280,height=800,left=200,top=100";

export async function openCustomerDisplayWindow(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  // Try Window Management API to place on the second monitor
  try {
    if ("getScreenDetails" in window) {
      const screenDetails = await (window as any).getScreenDetails();
      const screens: any[] = screenDetails.screens ?? [];
      // Prefer a non-primary screen; fall back to the current screen
      const target =
        screens.find((s) => !s.isPrimary) ??
        screenDetails.currentScreen ??
        screens[0];
      if (target) {
        const features = [
          "popup=yes",
          "noopener=no",
          `left=${target.availLeft}`,
          `top=${target.availTop}`,
          `width=${target.availWidth}`,
          `height=${target.availHeight}`,
        ].join(",");
        const w = window.open("/customer-display", WINDOW_NAME, features);
        if (w) {
          try { w.focus(); } catch { /* cross-origin — ignore */ }
          return true;
        }
      }
    }
  } catch {
    // API unavailable or permission denied — fall through to fallback
  }

  // Fallback: open at a fixed position (user can drag to second monitor)
  try {
    const w = window.open("/customer-display", WINDOW_NAME, FALLBACK_FEATURES);
    if (!w) return false;
    try { w.focus(); } catch { /* ignore */ }
    return true;
  } catch {
    return false;
  }
}
