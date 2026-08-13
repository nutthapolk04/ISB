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

/**
 * Claim the shared "isb-customer-display" window target without ever
 * navigating a window that's already showing our page.
 *
 * `trackedWindow` is a module-level variable, so it's only good for the
 * lifetime of the current tab's JS — it does NOT survive an F5/refresh of
 * the cashier's main window. But a same-tab refresh does not close the
 * popup, and the popup keeps answering to the same window *name* at the
 * browser level regardless of which JS module instance is asking. So after
 * a refresh, `trackedWindow` comes back null even though the real window is
 * still open, and calling `window.open(url, WINDOW_NAME, ...)` again would
 * reuse-and-navigate it — same spurious "Leave site?" prompt as the
 * remount case above, just triggered by a full-page refresh instead.
 *
 * Passing an empty-string URL sidesteps that: per spec, `window.open("",
 * name)` never navigates an existing same-name target, it only returns a
 * reference to it (a brand-new target still gets the requested features
 * applied, since there's nothing yet to preserve). So: if the returned
 * window's pathname already matches our route, it's a survivor from before
 * this module loaded — reuse in place. Otherwise it's genuinely fresh (or a
 * blank window this very call just created) and needs an initial navigate.
 */
function claimDisplayWindow(features: string): { w: Window; alreadyOpen: boolean } | null {
  const w = window.open("", WINDOW_NAME, features);
  if (!w) return null;
  let alreadyOpen: boolean;
  try {
    alreadyOpen = w.location.pathname === "/customer-display";
  } catch {
    // Cross-origin — can't be our own page, so it's the blank window this
    // call just created.
    alreadyOpen = false;
  }
  return { w, alreadyOpen };
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

  // Already holding a live reference (e.g. the cashier navigated away from
  // the POS page and back, re-triggering the auto-open effect) — just bring
  // it forward. Calling window.open() again with the same WINDOW_NAME would
  // reuse-and-navigate that existing window instead of opening a new one,
  // which fires its beforeunload guard and pops a spurious "Leave site?"
  // confirmation on screen 2.
  if (trackedWindow && !trackedWindow.closed) {
    try { trackedWindow.focus(); } catch { /* cross-origin — ignore */ }
    return true;
  }

  // Try Window Management API to place on the second monitor
  let features = FALLBACK_FEATURES;
  try {
    if ("getScreenDetails" in window) {
      const screenDetails = await (window as any).getScreenDetails();
      // Another concurrent call (e.g. AuthContext's post-login effect and
      // Canteen's/Store's mount effect both firing in the same commit) may
      // have already claimed and tracked the window while we were awaiting
      // permission/screen info above — recheck before doing anything else.
      if (trackedWindow && !trackedWindow.closed) {
        try { trackedWindow.focus(); } catch { /* cross-origin — ignore */ }
        return true;
      }
      const screens: any[] = screenDetails.screens ?? [];
      // Prefer a non-primary screen; fall back to the current screen
      const target =
        screens.find((s) => !s.isPrimary) ??
        screenDetails.currentScreen ??
        screens[0];
      if (target) {
        features = [
          "popup=yes",
          "noopener=no",
          "fullscreen=yes",
          `left=${target.availLeft}`,
          `top=${target.availTop}`,
          `width=${target.availWidth}`,
          `height=${target.availHeight}`,
        ].join(",");
      }
    }
  } catch {
    // API unavailable or permission denied — fall through with default features
  }

  try {
    const claimed = claimDisplayWindow(features);
    if (!claimed) return false;
    const { w, alreadyOpen } = claimed;
    if (!alreadyOpen) {
      w.location.replace("/customer-display");
      tryFullscreenPopup(w);
    }
    try { w.focus(); } catch { /* cross-origin — ignore */ }
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
