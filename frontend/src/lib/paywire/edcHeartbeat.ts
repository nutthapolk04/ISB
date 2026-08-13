import type { EdcClient } from "./client";

/**
 * Periodic hardware-liveness probe for the EDC terminal — catches the case
 * this feature exists for: the bridge still reports the USB/serial port as
 * open (so the /status WS keeps saying "connected") but the terminal itself
 * has hung and won't actually respond once a real sale is attempted.
 *
 * Deliberately dumb: one setInterval, one in-flight guard, one consecutive-
 * failure counter. All the "never touch a real transaction" guarantees live
 * in EdcClient.pingTerminal()/_txnStream (see client.ts) — this scheduler
 * just calls pingTerminal() on a timer and forwards the healthy/unhealthy
 * verdict. A ping that resolves `true` is treated as instant recovery
 * (matches the "assume fine, don't disturb it" skip inside pingTerminal());
 * only repeated real failures — never a single one — flip the status, so a
 * transient blip can't make the EDC tile flash red for no reason.
 */
export function startEdcHeartbeat(
  client: EdcClient,
  intervalMs: number,
  failThreshold = 2,
): void {
  let consecutiveFails = 0;
  let inFlight = false;

  setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    client
      .pingTerminal()
      .then((ok) => {
        if (ok) {
          consecutiveFails = 0;
          client.setHeartbeatHealthy(true);
        } else {
          consecutiveFails += 1;
          if (consecutiveFails >= failThreshold) client.setHeartbeatHealthy(false);
        }
      })
      .finally(() => { inFlight = false; });
  }, intervalMs);
}
