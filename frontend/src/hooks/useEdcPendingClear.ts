import { useEffect, useState } from "react";
import { getEdcClient } from "@/lib/paywire/edcClient";
import {
    hasAbandonedPendingTxn,
    pendingTxnRemainingMs,
    clearPendingTxn,
    PENDING_TXN_STORAGE_KEY,
} from "@/lib/paywire/edcPendingTxn";

/**
 * True while a new EDC payment must stay blocked — covers two cases with the
 * same marker (see edcPendingTxn.ts) and the same wait-then-confirm rule:
 *
 *   1. Cross-refresh: the page loaded and found a marker left behind by a
 *      refresh/tab-close that happened WHILE sale()/qrSale()/walletSale()
 *      was in flight.
 *   2. Same-session retry: client.ts marks pending the instant any payment
 *      command starts and only clears it once a TRUSTWORTHY result comes
 *      back (a real responseCode) — a blank/uncertain result (2026-08-25:
 *      overlapping SALE writes left the terminal returning empty/cross-wired
 *      responses) leaves the marker in place, and client.ts's _emitStatus()
 *      right after marking/clearing is what makes this hook notice within
 *      the same session, no refresh needed — a cashier backing out to the
 *      picker and hitting EDC again right after a failed attempt is blocked
 *      exactly like the refresh case, not just after a reload.
 *   3. Cross-tab: the marker lives in localStorage (shared across every tab
 *      of this origin, unlike sessionStorage) specifically because two open
 *      tabs each running their own copy of this check independently is
 *      exactly what let two SALE writes reach the terminal 14s apart with
 *      the first still unanswered (2026-08-25). The `storage` event below is
 *      what lets a SIBLING tab notice a marker it didn't write itself —
 *      onTerminalStatus alone only fires in the tab that actually ran the
 *      attempt.
 *
 * Either way, the terminal may still be mid-transaction on the wire, so a
 * second attempt risks colliding with it or double-charging. Two gates, both
 * required — neither alone is safe:
 *   1. Wait out the bridge's own txn timeout window (EDC_TXN_TIMEOUT_MS,
 *      from the marker's start time) — a quick comms probe succeeding
 *      earlier than this does NOT mean the terminal let go of the previous
 *      command (2026-08-25: pingTerminal succeeded while the terminal was
 *      still silently stuck on the abandoned SALE, and the very next SALE
 *      sent right after went nowhere).
 *   2. Once that window has passed, still confirm with pingTerminal() (same
 *      probe the heartbeat uses, never touches _txnStream) before unblocking
 *      — a slow/still-recovering bridge shouldn't get a new charge either.
 */
export function useEdcPendingClear(): boolean {
    const [pending, setPending] = useState(() => hasAbandonedPendingTxn());

    // Re-check on every EDC status broadcast — catches a new marker (or its
    // clearing) mid-session in THIS tab, not just at mount.
    useEffect(() => {
        const client = getEdcClient();
        return client.onTerminalStatus(() => setPending(hasAbandonedPendingTxn()));
    }, []);

    // Re-check on cross-tab storage writes — catches a marker set (or
    // cleared) by a SIBLING tab, which never fires this tab's own
    // onTerminalStatus.
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === PENDING_TXN_STORAGE_KEY || e.key === null) {
                setPending(hasAbandonedPendingTxn());
            }
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, []);

    useEffect(() => {
        if (!pending) return;
        let active = true;
        let pingIntervalId: ReturnType<typeof setInterval> | null = null;
        const client = getEdcClient();

        const startPinging = () => {
            const probe = () => {
                client.pingTerminal().then((ok) => {
                    if (!active || !ok) return;
                    clearPendingTxn();
                    setPending(false);
                });
            };
            probe();
            pingIntervalId = setInterval(probe, 3000);
        };

        const remaining = pendingTxnRemainingMs();
        const waitTimerId = setTimeout(startPinging, remaining);

        return () => {
            active = false;
            clearTimeout(waitTimerId);
            if (pingIntervalId) clearInterval(pingIntervalId);
        };
    }, [pending]);

    return pending;
}
