/**
 * Payment Successful — dwells for 5 seconds then auto-returns the
 * display to Standby (the parent CustomerDisplay component owns the
 * auto-back timer).
 */
import { CheckCircle2 } from "lucide-react";

import type { DisplayPayer, PaymentMethod } from "@/hooks/useDisplayBroadcast";
import { PayerCard } from "./PayerCard";

interface Props {
  total: number;
  payer: DisplayPayer | null;
  method: PaymentMethod;
  receiptNumber: string | null;
}

export function SuccessScreen({ total, payer, method, receiptNumber }: Props) {
  const showPayerCard =
    payer !== null && (method === "wallet" || method === "department");
  return (
    <div className="h-screen w-screen bg-gradient-to-br from-emerald-50 via-white to-emerald-50 flex flex-col items-center justify-center px-12">
      <CheckCircle2
        className="h-32 w-32 text-emerald-500 mb-6"
        strokeWidth={2}
      />
      <h1 className="text-6xl font-extrabold text-zinc-900">
        Payment Successful
      </h1>
      <p className="mt-4 text-2xl text-zinc-700">
        Thank you.{" "}
        <span className="font-bold tabular-nums">
          ฿
          {total.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>{" "}
        paid.
      </p>
      {receiptNumber && (
        <p className="mt-2 text-sm text-zinc-500">Receipt {receiptNumber}</p>
      )}

      {showPayerCard && payer && (
        <div className="w-full mt-10">
          <PayerCard payer={payer} total={total} successful />
        </div>
      )}
    </div>
  );
}
