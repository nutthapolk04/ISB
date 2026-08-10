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
const FALLBACK_FEATURES = "popup=yes,noopener=no,width=1280,height=800,left=200,top=100";

/**
 * Best-effort fullscreen for the just-opened/just-focused popup, called from
 * the opener right after `window.open()` while the click that triggered it is
 * still "fresh" — the browser can delegate the click's transient activation to
 * a same-origin auxiliary browsing context for a short window, but that
 * window is easy to miss once the popup's own bundle has to load, boot React,
 * and mount before it can try for itself. Firing from here instead — as soon
 * as the popup's `load` fires (or immediately, if we're just re-focusing an
 * already-loaded window) — gets there sooner. Not a substitute for
 * CustomerDisplay.tsx's own click-to-fullscreen fallback, since browsers are
 * free to reject this regardless of timing; just improves the odds the
 * cashier never has to tap the second screen at all.
 */
function tryFullscreenPopup(w: Window): void {
  const attempt = () => {
    try {
      w.document.documentElement.requestFullscreen?.().catch(() => { });
    } catch {
      // Cross-origin or otherwise inaccessible — nothing we can do from here.
    }
  };
  try {
    if (w.document?.readyState === "complete") {
      attempt();
    } else {
      w.addEventListener("load", attempt, { once: true });
    }
  } catch {
    // Cross-origin — ignore, CustomerDisplay.tsx's own click fallback covers it.
  }
}

// ── Watchdog: keep the display window alive no matter what happens on the
// cashier's own screen ──────────────────────────────────────────────────────
//
// The cashier alt-tabbing / switching apps on the main monitor must never take
// the customer display down with it — it's a second, independent top-level
// window on its own monitor, so normal window-switching on screen 1 can't
// touch it directly, but it CAN still end up closed by an accidental Ctrl+W,
// a crash, or someone closing it on purpose without meaning to for the whole
// shift. Track the last window we opened/focused and, once a watchdog timer
// notices `.closed` flip true, silently reopen it — no cashier action needed.
//
// This self-heal only works if the reopen isn't eaten by the popup blocker:
// window.open() calls outside a user gesture (which this is — it fires from
// a timer, not a click) are blocked by default. The installer sets Chrome's
// PopupsAllowedForUrls enterprise policy for our origin specifically so this
// works in the field (see installer.nsi) — without that policy the watchdog
// can detect the close but can't act on it.
let trackedWindow: Window | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

function trackAndWatch(w: Window): void {
  trackedWindow = w;
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    if (trackedWindow && trackedWindow.closed) {
      trackedWindow = null;
      void openCustomerDisplayWindow();
    }
  }, 3000);
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
          try { w.focus(); } catch { /* cross-origin — ignore */ }
          tryFullscreenPopup(w);
          trackAndWatch(w);
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
    tryFullscreenPopup(w);
    trackAndWatch(w);
    return true;
  } catch {
    return false;
  }
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
