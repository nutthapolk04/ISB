/**
 * Customer Display — the second-monitor, customer-facing page.
 *
 * Public route (no auth, no AppShell). Loads from /customer-display, the
 * cashier drags it to the second monitor and goes fullscreen. Switches
 * between Standby and the active checkout states based on what the
 * cashier window broadcasts.
 */
import { useDisplayState } from "@/hooks/useDisplayState";

import { StandbyScreen } from "./customer-display/StandbyScreen";
import { OrderReviewScreen } from "./customer-display/OrderReviewScreen";

export default function CustomerDisplay() {
  const display = useDisplayState();

  // Placeholder until the next commit lands the QR / Processing / Success /
  // Failed screens. Falls back to standby for any state we haven't built
  // the UI for yet so the customer never sees a blank page.
  switch (display.state) {
    case "review":
      return (
        <OrderReviewScreen
          items={display.items}
          total={display.total}
          payer={display.payer}
        />
      );
    case "standby":
    default:
      return <StandbyScreen />;
  }
}
