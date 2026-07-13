import { useEffect, useRef, useState } from "react";

export interface RfidNotif {
  key: number;
  type: "success" | "error";
  title: string;
  sub?: string;
}

interface UseRfidListenerOptions {
  /** Called with the captured code once a fast-typed Enter-terminated
   *  sequence is detected (keyboard path), or immediately when PC/SC bridge
   *  broadcasts a card UID (PC/SC WebSocket path). Caller owns the actual
   *  lookup/business logic — this hook only detects the RFID pattern. */
  onCapture: (code: string) => void | Promise<void>;
  /** Minimum buffered length before a captured sequence is treated as RFID
   *  input rather than a stray Enter press (keyboard path only). */
  minLength?: number;
}

/**
 * Dual-path RFID listener: WebSocket PC/SC bridge + keyboard fallback.
 *
 * **Path 1 (PC/SC)**: If rfid-bridge service is running on ws://localhost:9001,
 * listen for card_detected messages. Transparent to the rest of the app.
 *
 * **Path 2 (Keyboard)**: Fallback for keyboard-emulation RFID readers or manual
 * input. Buffer chars arriving < 50 ms apart, then emit on Enter.
 *
 * Both paths call onCapture(uid) identically, so the frontend pages don't need
 * separate logic for which reader type is connected.
 */
export function useRfidListener({ onCapture, minLength = 3 }: UseRfidListenerOptions) {
  const [notif, setNotif] = useState<RfidNotif | null>(null);
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifKey = useRef(0);

  // Keyboard path state
  const buffer = useRef<string>("");
  const lastKey = useRef<number>(0);
  const mode = useRef<boolean>(false);

  // WebSocket path state
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the latest onCapture in a ref so the listener effects below don't
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

  // PC/SC WebSocket path — try to connect to rfid-bridge on ws://localhost:9001
  useEffect(() => {
    const connectWebSocket = () => {
      try {
        const ws = new WebSocket("ws://localhost:9001");

        ws.onopen = () => {
          console.log("✅ Connected to RFID PC/SC bridge");
          wsRef.current = ws;
          // Clear any pending reconnect timer
          if (wsReconnectTimer.current) clearTimeout(wsReconnectTimer.current);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "card_detected" && data.uid) {
              void onCaptureRef.current(data.uid);
            }
          } catch (err) {
            console.warn("Failed to parse WebSocket message:", err);
          }
        };

        ws.onerror = (err) => {
          console.debug("RFID WebSocket error (PC/SC bridge may not be running):", err);
        };

        ws.onclose = () => {
          wsRef.current = null;
          // Retry connection every 3 seconds if bridge is running
          if (!wsReconnectTimer.current) {
            wsReconnectTimer.current = setTimeout(connectWebSocket, 3000);
          }
        };
      } catch (err) {
        console.debug("Failed to create WebSocket:", err);
        // Retry on error
        if (!wsReconnectTimer.current) {
          wsReconnectTimer.current = setTimeout(connectWebSocket, 3000);
        }
      }
    };

    connectWebSocket();

    return () => {
      if (wsReconnectTimer.current) clearTimeout(wsReconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

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
