import { useCallback, useEffect, useRef, useState } from "react";

interface UseRfidInputOptions {
  onSubmit: (uid: string) => void;
  enabled?: boolean;
  /** Keystroke interval below this = scanner. Default 50ms. */
  scannerThresholdMs?: number;
  /** Silence after last fast keystroke before auto-submit. Default 200ms. */
  autoSubmitSilenceMs?: number;
}

/**
 * Handles RFID/barcode scanner input with two behaviors:
 * - Fast keystrokes (< scannerThresholdMs apart) → auto-submit after silence
 * - Manual typing → submit on Enter key only
 * Also restores focus to the input whenever a keypress fires while the dialog
 * is open, so the scanner works even if the user accidentally clicked elsewhere.
 */
export function useRfidInput({
  onSubmit,
  enabled = true,
  scannerThresholdMs = 50,
  autoSubmitSilenceMs = 200,
}: UseRfidInputOptions) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const lastCharTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always call the latest version of onSubmit (avoids stale closure).
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  });

  // Restore focus to the input on any keypress while enabled.
  useEffect(() => {
    if (!enabled) return;
    const refocus = (e: KeyboardEvent) => {
      if (e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.activeElement !== inputRef.current) {
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", refocus);
    return () => window.removeEventListener("keydown", refocus);
  }, [enabled]);

  // Clear pending timer when disabled or on unmount.
  useEffect(() => {
    if (!enabled && timerRef.current) clearTimeout(timerRef.current);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled]);

  const flush = useCallback((uid: string) => {
    const trimmed = uid.trim();
    setValue("");
    lastCharTimeRef.current = 0;
    if (trimmed) onSubmitRef.current(trimmed);
  }, []);

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVal = e.target.value;
      setValue(newVal);
      if (!newVal.trim()) return;

      const now = Date.now();
      const elapsed = now - lastCharTimeRef.current;
      lastCharTimeRef.current = now;

      if (elapsed > 0 && elapsed < scannerThresholdMs) {
        // Scanner speed: schedule auto-submit after silence
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => flush(newVal), autoSubmitSilenceMs);
      } else {
        // Manual typing: cancel any pending auto-submit
        if (timerRef.current) clearTimeout(timerRef.current);
      }
    },
    [scannerThresholdMs, autoSubmitSilenceMs, flush],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        if (timerRef.current) clearTimeout(timerRef.current);
        flush(value);
      }
    },
    [flush, value],
  );

  return { value, setValue, inputRef, onChange, onKeyDown };
}
