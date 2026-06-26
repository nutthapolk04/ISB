/**
 * useDisplayBroadcast — cashier (POS) side.
 *
 * Wraps the `pos-display` BroadcastChannel + a localStorage mirror so the
 * customer-display window can recover the live state on (re)open.
 *
 * Usage:
 *   const display = useDisplayBroadcast();
 *   display.review({ items, total, payer });
 *   display.qr({ items, total, qrPayload, expiresAt });
 *   display.processing({ items, total, payer, method: "cash" });
 *   display.success({ total, payer, method, receiptNumber });
 *   display.failed({ reason, method });
 *   display.standby();
 */
import { useEffect, useMemo, useRef } from "react";

// ── Shared types ─────────────────────────────────────────────────────────

export interface DisplayItem {
  name: string;
  qty: number;
  price: number; // line total in THB
}

export interface SpendingLimitData {
  daily_limit: number;
  spent_today: number;
  remaining: number;
  group_name: string;
}

export interface DisplayPayer {
  kind: "customer" | "user" | "department" | "guest";
  name: string;
  code: string | null;
  role: string | null; // e.g. "Student · Grade 6"
  balanceBefore: number | null;
  balanceAfter: number | null;
  /** The active shop's limit — used by the cashier-side confirm dialog. */
  spendingLimit?: SpendingLimitData | null;
  /** Both limits surfaced to the customer-display so the student sees a full picture. */
  canteenLimit?: SpendingLimitData | null;
  storeLimit?: SpendingLimitData | null;
}

export type PaymentMethod =
  | "cash"
  | "wallet"
  | "card"
  | "edc"
  | "department"
  | "qr";

export type DisplayState =
  | { state: "standby" }
  | {
      state: "review";
      items: DisplayItem[];
      total: number;
      payer: DisplayPayer | null;
    }
  | {
      state: "qr";
      items: DisplayItem[];
      total: number;
      qrPayload: string;
      expiresAt: number | null; // ms epoch
    }
  | {
      state: "processing";
      items: DisplayItem[];
      total: number;
      payer: DisplayPayer | null;
      method: PaymentMethod;
    }
  | {
      state: "success";
      total: number;
      payer: DisplayPayer | null;
      method: PaymentMethod;
      receiptNumber: string | null;
    }
  | {
      state: "failed";
      reason: string;
      method: PaymentMethod;
      payer?: DisplayPayer | null;
    };

const STORAGE_KEY = "pos-display-state";
const CHANNEL_NAME = "pos-display";

// ── Hook ─────────────────────────────────────────────────────────────────

export function useDisplayBroadcast() {
  const chRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    chRef.current = new BroadcastChannel(CHANNEL_NAME);
    return () => {
      chRef.current?.close();
      chRef.current = null;
    };
  }, []);

  const publish = useMemo(
    () => (payload: DisplayState) => {
      try {
        chRef.current?.postMessage(payload);
      } catch {
        /* channel closed — ignore */
      }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        /* quota / private mode — ignore */
      }
    },
    [],
  );

  return useMemo(
    () => ({
      raw: publish,
      standby: () => publish({ state: "standby" }),
      review: (p: Omit<Extract<DisplayState, { state: "review" }>, "state">) =>
        publish({ state: "review", ...p }),
      qr: (p: Omit<Extract<DisplayState, { state: "qr" }>, "state">) =>
        publish({ state: "qr", ...p }),
      processing: (
        p: Omit<Extract<DisplayState, { state: "processing" }>, "state">,
      ) => publish({ state: "processing", ...p }),
      success: (p: Omit<Extract<DisplayState, { state: "success" }>, "state">) =>
        publish({ state: "success", ...p }),
      failed: (p: Omit<Extract<DisplayState, { state: "failed" }>, "state">) =>
        publish({ state: "failed", ...p }),
    }),
    [publish],
  );
}
