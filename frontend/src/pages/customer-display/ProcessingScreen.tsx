/**
 * Processing — shown after the cashier confirms a non-QR payment.
 * Body varies by method:
 *   - cash:        simple spinner
 *   - wallet/RFID: PayerCard (balance preview) + spinner
 *   - card/EDC:    "Insert or Tap Your Card" prompt
 *   - department:  PayerCard (department budget) + spinner
 */
import { Loader2 } from "lucide-react";

import type { DisplayItem, DisplayPayer, PaymentMethod } from "@/hooks/useDisplayBroadcast";
import { PayerCard } from "./PayerCard";

interface Props {
  items: DisplayItem[];
  total: number;
  payer: DisplayPayer | null;
  method: PaymentMethod;
}

function HeaderCopy({ method }: { method: PaymentMethod }) {
  switch (method) {
    case "card":
    case "edc":
      return (
        <>
          <h1 className="text-5xl font-extrabold text-zinc-900">
            Insert or Tap Your Card
          </h1>
          <p className="mt-3 text-lg text-zinc-500">
            Follow the prompts on the card reader
          </p>
        </>
      );
    case "department":
      return (
        <>
          <h1 className="text-5xl font-extrabold text-zinc-900">
            Charging Department Budget…
          </h1>
          <p className="mt-3 text-lg text-zinc-500">Please wait</p>
        </>
      );
    case "cash":
    case "wallet":
    default:
      return (
        <>
          <h1 className="text-5xl font-extrabold text-zinc-900">
            Processing Payment…
          </h1>
          <p className="mt-3 text-lg text-zinc-500">Please wait</p>
        </>
      );
  }
}

export function ProcessingScreen({ items, total, payer, method }: Props) {
  void items; // not currently rendered, but available if the layout grows
  const showPayerCard =
    payer !== null && (method === "wallet" || method === "department");
  return (
    <div className="h-screen w-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 flex flex-col items-center justify-center px-12">
      <div className="text-center mb-10">
        <HeaderCopy method={method} />
      </div>

      {showPayerCard && payer && (
        <div className="w-full mb-10">
          <PayerCard payer={payer} total={total} />
        </div>
      )}

      {!showPayerCard && (
        <div className="text-6xl font-extrabold tabular-nums text-amber-600 mb-10">
          ฿
          {total.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </div>
      )}

      <Loader2 className="h-16 w-16 animate-spin text-amber-500" strokeWidth={2} />
    </div>
  );
}
