import { useEffect, useState } from "react";
import { getEdcClient, readyEdc } from "@/lib/paywire/edcClient";

export type EdcTerminalStatus = "connected" | "disconnected" | "unknown";

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
        const edc = getEdcClient();
        const unsubscribe = edc.onTerminalStatus((s) => {
            if (!active) return;
            setStatus(s.state === "connected" ? "connected" : "disconnected");
        });
        readyEdc()
            .then(() => {
                if (active) setStatus(edc.terminalConnected ? "connected" : "disconnected");
            })
            .catch(() => {
                if (active) setStatus("disconnected");
            });
        return () => {
            active = false;
            unsubscribe();
        };
    }, []);

    return status;
}
