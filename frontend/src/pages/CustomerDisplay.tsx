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
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Browsers gate Fullscreen API behind a user gesture; the cashier just
  // has to tap the screen once after dragging the window to the second
  // monitor. We then suppress the hint and stay fullscreen until the OS
  // or browser exits.
  useEffect(() => {
    const enter = () => {
      if (document.fullscreenElement) return;
      document.documentElement.requestFullscreen().catch(() => {});
    };
    document.addEventListener("click", enter);
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("click", enter);
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, []);

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

  const fsHint = !isFullscreen ? (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm cursor-pointer">
      <div className="flex flex-col items-center gap-4 text-white text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-90">
          <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
        </svg>
        <p className="text-3xl font-bold">แตะหน้าจอเพื่อเปิดเต็มจอ</p>
        <p className="text-lg opacity-70">Tap to enter fullscreen</p>
      </div>
    </div>
  ) : null;

  const screen = (() => {
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
        return <FailedScreen reason={display.reason} payer={display.payer ?? null} />;
      case "standby":
      default:
        return <StandbyScreen />;
    }
  })();

  return (
    <>
      {screen}
      {fsHint}
    </>
  );
}
