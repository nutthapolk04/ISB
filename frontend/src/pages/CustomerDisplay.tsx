/**
 * Customer Display — the second-monitor, customer-facing page.
 *
 * Public route (no auth, no AppShell). Loads from /customer-display, the
 * cashier drags it to the second monitor and goes fullscreen. Switches
 * between Standby and the active checkout states based on what the
 * cashier window broadcasts.
 *
 * Owns the auto-back-to-standby timer for the Success / Failed states so
 * every callsite from the POS only has to broadcast the final result
 * once — the display window auto-returns to Standby 5 seconds later.
 */
import { useEffect, useState } from "react";

import { useDisplayState } from "@/hooks/useDisplayState";

import { StandbyScreen } from "./customer-display/StandbyScreen";
import { OrderReviewScreen } from "./customer-display/OrderReviewScreen";
import { QRScreen } from "./customer-display/QRScreen";
import { ProcessingScreen } from "./customer-display/ProcessingScreen";
import { SuccessScreen } from "./customer-display/SuccessScreen";
import { FailedScreen } from "./customer-display/FailedScreen";

const TERMINAL_DWELL_MS = 5000;

export default function CustomerDisplay() {
  const display = useDisplayState();
  const [forceStandby, setForceStandby] = useState(false);

  // Whenever a fresh non-terminal state arrives, clear the "force standby"
  // override so the next transaction is rendered normally.
  useEffect(() => {
    if (display.state !== "success" && display.state !== "failed") {
      setForceStandby(false);
    }
  }, [display.state]);

  // Auto-return to Standby 5 s after a terminal state lands. We don't push
  // a "standby" broadcast from here — that's the POS's job. We just stop
  // rendering the result locally so the customer sees the standby rotation
  // again until the next transaction.
  useEffect(() => {
    if (display.state !== "success" && display.state !== "failed") return;
    const id = window.setTimeout(() => setForceStandby(true), TERMINAL_DWELL_MS);
    return () => window.clearTimeout(id);
  }, [display]);

  if (forceStandby) return <StandbyScreen />;

  switch (display.state) {
    case "review":
      return (
        <OrderReviewScreen
          items={display.items}
          total={display.total}
          payer={display.payer}
        />
      );
    case "qr":
      return (
        <QRScreen
          items={display.items}
          total={display.total}
          qrPayload={display.qrPayload}
          expiresAt={display.expiresAt}
        />
      );
    case "processing":
      return (
        <ProcessingScreen
          items={display.items}
          total={display.total}
          payer={display.payer}
          method={display.method}
        />
      );
    case "success":
      return (
        <SuccessScreen
          total={display.total}
          payer={display.payer}
          method={display.method}
          receiptNumber={display.receiptNumber}
        />
      );
    case "failed":
      return <FailedScreen reason={display.reason} />;
    case "standby":
    default:
      return <StandbyScreen />;
  }
}
