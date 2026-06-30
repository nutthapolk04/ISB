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
 *
 * For automatic popping on POS entry / login, use `autoOpenCustomerDisplayWindow`
 * which adds a multi-monitor guard so single-screen PCs / notebooks don't
 * get a stray window every time the cashier opens the app.
 */
const WINDOW_NAME = "isb-customer-display";
const FALLBACK_FEATURES = "popup=yes,noopener=no,fullscreen=yes,width=1280,height=800,left=200,top=100";

// Module-level handle to the popup so callers can ping it after user gestures.
let popupWin: Window | null = null;

/** Get the live popup handle (or null if it's been closed). */
export function getCustomerDisplayWindow(): Window | null {
  if (popupWin && !popupWin.closed) return popupWin;
  popupWin = null;
  return null;
}

/**
 * Try to fullscreen the popup using the CURRENT call's user activation. The
 * popup is same-origin so the parent can call requestFullscreen on the
 * popup's documentElement — activation flows from the parent's gesture.
 *
 * Call this from event handlers attached to user input (click, keydown)
 * on the parent (POS) window.
 */
export function ensureCustomerDisplayFullscreen(): void {
  const win = getCustomerDisplayWindow();
  if (!win) return;
  try {
    const doc = win.document;
    if (!doc || doc.fullscreenElement) return;
    const el = doc.documentElement;
    if (el && el.requestFullscreen) {
      el.requestFullscreen().catch(() => { /* ignore */ });
    }
  } catch {
    // Cross-origin or popup torn down — ignore.
  }
}

/** Probe whether the host station has ≥2 monitors available. Returns false
 *  on Safari / Firefox (no API), when the permission is denied, or when
 *  only the primary screen is connected. */
async function hasSecondaryMonitor(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("getScreenDetails" in window)) return false;
  try {
    const screenDetails = await (window as any).getScreenDetails();
    const screens: any[] = screenDetails.screens ?? [];
    return screens.length >= 2;
  } catch {
    // Permission denied or API failure → treat as single screen (safe default).
    return false;
  }
}

/**
 * Manual entry point — pop the customer display window unconditionally.
 * Use from explicit user gestures (header button, settings page) where the
 * user has decided they want the window to appear right now.
 */
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
          "fullscreen=yes",
          `left=${target.availLeft}`,
          `top=${target.availTop}`,
          `width=${target.availWidth}`,
          `height=${target.availHeight}`,
        ].join(",");
        const w = window.open("/customer-display", WINDOW_NAME, features);
        if (w) {
          popupWin = w;
          try { w.focus(); } catch { /* cross-origin — ignore */ }
          tryFullscreenWithRetry(w);
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
    popupWin = w;
    try { w.focus(); } catch { /* ignore */ }
    tryFullscreenWithRetry(w);
    return true;
  } catch {
    return false;
  }
}

/**
 * After the popup is created, the parent's `window.open()` user activation
 * is still valid for a few seconds in the popup's task queue. Poll for the
 * popup's documentElement and request fullscreen as soon as the DOM exists.
 */
function tryFullscreenWithRetry(win: Window): void {
  let attempts = 0;
  const iv = setInterval(() => {
    attempts += 1;
    if (attempts > 25 || win.closed) {
      clearInterval(iv);
      return;
    }
    try {
      const doc = win.document;
      if (!doc) return;
      if (doc.fullscreenElement) {
        clearInterval(iv);
        return;
      }
      const el = doc.documentElement;
      if (el && el.requestFullscreen) {
        el.requestFullscreen().catch(() => { /* ignore */ });
      }
    } catch {
      // popup not yet accessible — keep polling
    }
  }, 200);
}

/**
 * Automatic entry point — pop only when the host actually has ≥2 monitors.
 *
 * Used by the POS pages (Canteen, Store) and the post-login hook so that
 * managers / admins on a single-screen laptop don't get a stray customer
 * display window every time they navigate into the app. The cashier station
 * still pops automatically because it has a second monitor wired up.
 *
 * Returns false (without opening anything) when the Screen Management API
 * isn't available, when permission is denied, or when only one screen is
 * connected. Returns the underlying `openCustomerDisplayWindow` result
 * otherwise.
 */
export async function autoOpenCustomerDisplayWindow(): Promise<boolean> {
  if (!(await hasSecondaryMonitor())) return false;
  return openCustomerDisplayWindow();
}
