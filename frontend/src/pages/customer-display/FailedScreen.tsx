/**
 * Payment Failed — dwells for 5 seconds then auto-returns to Standby.
 * Auto-back timer is owned by the parent CustomerDisplay component.
 */
import { XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DisplayPayer, SpendingLimitData } from "@/hooks/useDisplayBroadcast";

interface Props {
  reason: string;
  payer?: DisplayPayer | null;
}

function LimitRow({ label, sl }: { label: string; sl: SpendingLimitData }) {
  const pct = sl.daily_limit > 0 ? (sl.spent_today / sl.daily_limit) * 100 : 0;
  const atLimit = pct >= 100;
  const nearLimit = pct >= 80 && !atLimit;
  const color = atLimit ? "text-red-600" : nearLimit ? "text-amber-600" : "text-emerald-700";
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-zinc-700 font-medium">{label}</span>
      <span className={cn("text-xl font-bold tabular-nums", color)}>
        ฿{sl.spent_today.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        <span className="text-zinc-400 font-normal"> / </span>
        ฿{sl.daily_limit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </span>
    </div>
  );
}

export function FailedScreen({ reason, payer }: Props) {
  const canteen = payer?.canteenLimit && payer.canteenLimit.daily_limit > 0 ? payer.canteenLimit : null;
  const store = payer?.storeLimit && payer.storeLimit.daily_limit > 0 ? payer.storeLimit : null;
  const showLimits = canteen || store;

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-red-50 via-white to-red-50 flex flex-col items-center justify-center px-12 gap-6">
      <XCircle className="h-28 w-28 text-red-500" strokeWidth={2} />
      <h1 className="text-5xl font-extrabold text-zinc-900">Payment Failed</h1>
      <p className="text-2xl text-red-700 font-medium max-w-3xl text-center">{reason}</p>

      {showLimits && (
        <div className="w-full max-w-xl bg-white rounded-2xl border border-red-100 shadow-sm p-5 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Daily Spending Limit
          </div>
          {canteen && <LimitRow label="Canteen" sl={canteen} />}
          {store && <LimitRow label="Store" sl={store} />}
        </div>
      )}

      <p className="text-base text-zinc-500">Please ask the cashier to try again.</p>
    </div>
  );
}
