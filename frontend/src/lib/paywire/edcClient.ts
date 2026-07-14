// App-level accessor for the vendored Paywire EDC bridge SDK. Keeps a single
// EdcClient instance around (it owns a /status WebSocket) and caches the
// ready() promise so callers can await it repeatedly without re-connecting.
import { EdcClient } from "./index";

let client: EdcClient | null = null;
let readyPromise: Promise<void> | null = null;

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
