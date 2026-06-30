/**
 * useDisplayState — customer-display window side.
 *
 * Subscribes to the `pos-display` BroadcastChannel and exposes the latest
 * state payload published by the cashier-side helper. Also reads
 * localStorage['pos-display-state'] on mount so a freshly opened display
 * window doesn't sit on standby while the cashier is mid-checkout — it
 * picks up the live state immediately.
 *
 * The cashier window writes to the same localStorage key on every publish
 * so the two windows stay in sync even across reload / accidental close.
 */
import { useEffect, useState } from "react";

import type { DisplayState } from "./useDisplayBroadcast";

const STORAGE_KEY = "pos-display-state";
const CHANNEL_NAME = "pos-display";

const STANDBY: DisplayState = { state: "standby" };

function readPersistedState(): DisplayState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return STANDBY;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "state" in parsed) {
      return parsed as DisplayState;
    }
  } catch {
    /* corrupt entry — fall through to standby */
  }
  return STANDBY;
}

export function useDisplayState(): DisplayState {
  const [state, setState] = useState<DisplayState>(STANDBY);

  // Hydrate from localStorage once on mount so re-opens don't blink to
  // standby in the middle of a transaction.
  useEffect(() => {
    setState(readPersistedState());
  }, []);

  // Live updates from the cashier window.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL_NAME);
    ch.onmessage = (e) => {
      const data = e?.data;
      if (!data || typeof data !== "object") return;
      // Respond to presence pings from cashier so they can detect that a
      // standalone customer-display window is already running and skip the
      // auto-popup. Reply on the same channel.
      if ((data as { type?: string }).type === "customer-display-ping") {
        try { ch.postMessage({ type: "customer-display-pong" }); } catch { /* ignore */ }
        return;
      }
      if ((data as { type?: string }).type === "customer-display-shutdown") {
        // Cashier logged out — close this window. Browsers may block
        // close() on windows not opened by script, in which case we
        // navigate to about:blank as a visible signal.
        try { window.close(); } catch { /* ignore */ }
        try { window.location.replace("about:blank"); } catch { /* ignore */ }
        return;
      }
      if ("state" in data) {
        setState(data as DisplayState);
      }
    };
    return () => ch.close();
  }, []);

  // Storage-event fallback — also covers the case where the cashier window
  // is a different tab (not just another window of the same process).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed && typeof parsed === "object" && "state" in parsed) {
          setState(parsed as DisplayState);
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return state;
}
