import { useEffect, useState } from "react";
import { ensureEdcHeartbeat, getEdcClient, readyEdc } from "@/lib/paywire/edcClient";

export type EdcTerminalStatus = "connected" | "disconnected" | "unknown";

// ready() never opens the /status WS on failure (see EdcClient._connectStatus,
// only reached after whoami succeeds), so a bridge that isn't up yet — e.g.
// paywire.exe still starting while the kiosk browser has already loaded the
// page — has nothing else to retry the connection. Poll at the same cadence
// EdcClient itself uses for WS reconnects (client.ts's 3000ms) until ready()
// succeeds; from then on the WS's own reconnect loop takes over.
const RETRY_MS = 3000;

/**
 * Tracks the EDC bridge/terminal connection status for as long as the
 * calling component is mounted — not gated on any modal being open, so the
 * payment method picker can show a live connection dot on the EDC tile
 * before the cashier ever opens it.
 *
 * Shares the underlying EdcClient singleton (getEdcClient()/readyEdc() both
 * cache), so calling this from multiple components (picker + modal) never
 * opens a second connection to the bridge.
 */
export function useEdcTerminalStatus(): EdcTerminalStatus {
    const [status, setStatus] = useState<EdcTerminalStatus>("unknown");

    useEffect(() => {
        let active = true;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        const edc = getEdcClient();
        // No-op unless VITE_EDC_HEARTBEAT_MS is explicitly set (see
        // edcClient.ts) — safe to call from every mount of this hook.
        ensureEdcHeartbeat();
        const unsubscribe = edc.onTerminalStatus((s) => {
            if (!active) return;
            setStatus(s.state === "connected" ? "connected" : "disconnected");
        });

        const tryConnect = () => {
            readyEdc()
                .then(() => {
                    if (active) setStatus(edc.terminalConnected ? "connected" : "disconnected");
                })
                .catch(() => {
                    if (!active) return;
                    setStatus("disconnected");
                    retryTimer = setTimeout(tryConnect, RETRY_MS);
                });
        };
        tryConnect();

        return () => {
            active = false;
            if (retryTimer) clearTimeout(retryTimer);
            unsubscribe();
        };
    }, []);

    return status;
}
