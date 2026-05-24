// Per-device, per-POS auto-print preference. Stored in localStorage so each
// cashier station can decide whether checkout silently opens the print window
// or stays quiet (useful when a station has no printer attached).
import { useEffect, useState } from "react";

const STORAGE_PREFIX = "isb.autoPrint.";

function readStored(key: string): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
  // Default ON when no preference saved yet so behaviour matches the
  // pre-toggle world.
  if (raw === null) return true;
  return raw === "1";
}

function writeStored(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_PREFIX + key, value ? "1" : "0");
}

/**
 * @param scope  A stable key per POS (e.g. `canteen`, `store:coop`). The
 *   preference is namespaced so a cashier covering multiple shops keeps
 *   independent toggles.
 */
export function useAutoPrint(scope: string): [boolean, (v: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => readStored(scope));

  // Re-sync when scope changes (e.g. cashier switches shops via role picker
  // without a full reload).
  useEffect(() => {
    setEnabled(readStored(scope));
  }, [scope]);

  const update = (v: boolean) => {
    writeStored(scope, v);
    setEnabled(v);
  };

  return [enabled, update];
}
