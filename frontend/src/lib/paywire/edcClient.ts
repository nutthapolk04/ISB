// App-level accessor for the vendored Paywire EDC bridge SDK. Keeps a single
// EdcClient instance around (it owns a /status WebSocket) and caches the
// ready() promise so callers can await it repeatedly without re-connecting.
import { EdcClient } from "./index";
import { startEdcHeartbeat } from "./edcHeartbeat";

let client: EdcClient | null = null;
let readyPromise: Promise<void> | null = null;
let heartbeatStarted = false;

/** Lazily creates and returns the shared EdcClient instance. */
export function getEdcClient(): EdcClient {
  if (!client) {
    const domain = import.meta.env.VITE_EDC_BRIDGE_DOMAIN as string | undefined;
    client = new EdcClient(domain ? { domain } : {});
  }
  return client;
}

/**
 * Calls EdcClient.ready() once and caches the promise so repeated callers
 * share the same in-flight/settled call. If a previous attempt failed, the
 * next call retries (the failed promise is not cached).
 */
export function readyEdc(): Promise<void> {
  if (!readyPromise) {
    readyPromise = getEdcClient()
      .ready()
      .catch((err) => {
        readyPromise = null;
        throw err;
      });
  }
  return readyPromise;
}

/**
 * Starts the optional hardware-liveness heartbeat exactly once, and only if
 * VITE_EDC_HEARTBEAT_MS is set to a positive number — unset (the default for
 * every station today) makes this a complete no-op, so nothing about
 * today's behavior changes until a station explicitly opts in after
 * confirming on the real terminal that a `commstest` probe doesn't do
 * anything visible on its screen. Clamped to a 5s floor so a misconfigured
 * tiny value can't hammer the bridge. Safe to call from every mount site
 * that already calls readyEdc() — idempotent past the first call.
 */
export function ensureEdcHeartbeat(): void {
  if (heartbeatStarted) return;
  const raw = Number(import.meta.env.VITE_EDC_HEARTBEAT_MS ?? 0);
  if (!raw || raw <= 0) return;
  heartbeatStarted = true;
  startEdcHeartbeat(getEdcClient(), Math.max(5000, raw));
}
