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

function LimitMini({ title, sl }: { title: string; sl: SpendingLimitData }) {
  const pct = sl.daily_limit > 0 ? Math.min((sl.spent_today / sl.daily_limit) * 100, 100) : 0;
  const atLimit = pct >= 100;
  const nearLimit = pct >= 80 && !atLimit;
  const barColor = atLimit ? "bg-red-500" : nearLimit ? "bg-amber-500" : "bg-emerald-500";
  const remainColor = atLimit ? "text-red-600" : nearLimit ? "text-amber-600" : "text-emerald-600";
  return (
    <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-5">
      <div className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">{title}</div>
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <div className="text-xs text-zinc-500 mb-1">Daily Limit</div>
          <div className="text-xl font-bold tabular-nums text-zinc-800">
            ฿{sl.daily_limit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-zinc-500 mb-1">Spent Today</div>
          <div className="text-xl font-bold tabular-nums text-orange-500">
            ฿{sl.spent_today.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-zinc-500 mb-1">Remaining</div>
          <div className={cn("text-xl font-bold tabular-nums", remainColor)}>
            ฿{sl.remaining.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>
      <div className="w-full h-2.5 rounded-full bg-zinc-100 overflow-hidden mt-3">
        <div className={cn("h-full rounded-full", barColor)} style={{ width: `${pct}%` }} />
      </div>
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
        <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-3">
          {canteen && <LimitMini title="Daily Canteen Limit" sl={canteen} />}
          {store && <LimitMini title="Daily Store Limit" sl={store} />}
        </div>
      )}

      <p className="text-base text-zinc-500">Please ask the cashier to try again.</p>
    </div>
  );
}
