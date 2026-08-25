// Marker for "a payment command was sent to the EDC terminal and we never
// saw it resolve" -- localStorage, not sessionStorage or in-memory state,
// for two reasons that both matter here:
//   1. Survives a refresh/tab-close while sale()/qrSale()/walletSale() is
//      still in flight, same as sessionStorage would.
//   2. Shares across every tab of this origin, which sessionStorage does
//      NOT (2026-08-25: two SALE writes landed on the physical wire only
//      14s apart with the first still unanswered -- traced to two open
//      tabs, each running its own independent copy of this check against
//      sessionStorage, neither aware the other had a payment in flight on
//      the SAME single-threaded serial link). useEdcPendingClear.ts also
//      listens for the `storage` event so another tab reacts to this the
//      instant it's set, not just at its own next mount.
//
// client.ts writes this at the start of a payment command and clears it in
// its `finally` (see _txnStream) once — and only once — a trustworthy result
// comes back; a marker still present later (next load, or read from another
// tab right now) means the terminal may still be mid-transaction.
export const PENDING_TXN_STORAGE_KEY = "paywire:pending_payment";
const KEY = PENDING_TXN_STORAGE_KEY;

// Mirrors paywire.yaml's `txn_timeout_secs: 90` -- the bridge itself won't
// give up on a SALE the terminal never answered until this long has passed
// (confirmed 2026-08-25: a "device: connection lost" only appeared exactly
// ~90s after the TX with no RX). A quick pingTerminal() success proves the
// bridge's HTTP layer is alive, NOT that the terminal has actually let go of
// the abandoned command -- observed the same day: pingTerminal succeeded
// (unblocking the old version of this check) while the terminal was still
// silently chewing on the previous SALE, so a new one sent right after it
// went nowhere. Wait out the full window before trusting a ping at all.
export const EDC_TXN_TIMEOUT_MS = 90_000;

interface PendingTxnMarker {
  cmd: string;
  reqId: string;
  startedAt: number;
}

function readMarker(): PendingTxnMarker | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingTxnMarker;
  } catch {
    return null;
  }
}

export function markPendingTxn(cmd: string, reqId: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ cmd, reqId, startedAt: Date.now() }));
  } catch {
    // Storage can throw (private mode, quota) -- losing this marker just
    // means the next-load safety check below doesn't fire, not a crash.
  }
}

export function clearPendingTxn(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // See markPendingTxn.
  }
}

export function hasAbandonedPendingTxn(): boolean {
  return readMarker() !== null;
}

/** Milliseconds still left to wait before the bridge's own txn timeout has
 *  definitely elapsed for the abandoned command; 0 once it has. */
export function pendingTxnRemainingMs(): number {
  const marker = readMarker();
  if (!marker) return 0;
  return Math.max(0, EDC_TXN_TIMEOUT_MS - (Date.now() - marker.startedAt));
}
