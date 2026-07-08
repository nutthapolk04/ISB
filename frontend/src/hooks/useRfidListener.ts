import { useEffect, useRef, useState } from "react";

export interface RfidNotif {
  key: number;
  type: "success" | "error";
  title: string;
  sub?: string;
}

interface UseRfidListenerOptions {
  /** Called with the captured code once a fast-typed Enter-terminated
   *  sequence is detected. Caller owns the actual lookup/business logic —
   *  this hook only detects the RFID-reader keystroke pattern. */
  onCapture: (code: string) => void | Promise<void>;
  /** Minimum buffered length before a captured sequence is treated as RFID
   *  input rather than a stray Enter press. */
  minLength?: number;
}

/**
 * Passive RFID listener (capture phase). RFID readers emit keypresses as
 * fast keyboard input, ending with Enter. Uses capture phase (true) so we
 * intercept BEFORE focused inputs receive chars.
 *
 * Strategy:
 *   - Buffer chars arriving < 50 ms apart (RFID speed)
 *   - On 2nd+ fast char: enter rfidMode → preventDefault to stop chars going into inputs
 *   - On Enter in rfidMode: call onCapture with the buffered code
 *   - Gap > 100 ms resets buffer (human typing)
 */
export function useRfidListener({ onCapture, minLength = 3 }: UseRfidListenerOptions) {
  const [notif, setNotif] = useState<RfidNotif | null>(null);
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifKey = useRef(0);

  const buffer = useRef<string>("");
  const lastKey = useRef<number>(0);
  const mode = useRef<boolean>(false);

  // Keep the latest onCapture in a ref so the listener effect below doesn't
  // need to re-subscribe every render when callers pass an inline function.
  const onCaptureRef = useRef(onCapture);
  useEffect(() => { onCaptureRef.current = onCapture; }, [onCapture]);

  const showNotif = (n: Omit<RfidNotif, "key">) => {
    if (notifTimer.current) clearTimeout(notifTimer.current);
    notifKey.current += 1;
    setNotif({ ...n, key: notifKey.current });
    notifTimer.current = setTimeout(() => setNotif(null), 2500);
  };

  const dismissNotif = () => {
    if (notifTimer.current) clearTimeout(notifTimer.current);
    setNotif(null);
  };

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const now = Date.now();
      const gap = now - lastKey.current;

      if (e.key === "Enter") {
        if (mode.current && buffer.current.length >= minLength) {
          e.preventDefault();
          e.stopPropagation();
          const captured = buffer.current;
          buffer.current = "";
          mode.current = false;
          lastKey.current = 0;
          void onCaptureRef.current(captured);
        } else {
          // Not RFID — reset
          buffer.current = "";
          mode.current = false;
        }
        return;
      }

      if (e.key.length !== 1) return;

      // Reset if gap too large (human typing pace)
      if (gap > 100 && buffer.current.length > 0) {
        buffer.current = "";
        mode.current = false;
      }

      lastKey.current = now;
      buffer.current += e.key;

      // 2nd+ char within 50 ms → RFID reader speed detected
      if (gap < 50 && buffer.current.length >= 2) {
        mode.current = true;
      }

      // In RFID mode: prevent char from reaching any focused input
      if (mode.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    // capture: true — fires before focused element receives the event
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [minLength]);

  return { notif, showNotif, dismissNotif };
}
