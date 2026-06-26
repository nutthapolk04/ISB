/**
 * Payment Failed — dwells for 5 seconds then auto-returns to Standby.
 * Auto-back timer is owned by the parent CustomerDisplay component.
 */
import { XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DisplayPayer } from "@/hooks/useDisplayBroadcast";

interface Props {
  reason: string;
  payer?: DisplayPayer | null;
}

export function FailedScreen({ reason, payer }: Props) {
  const sl = payer?.spendingLimit ?? null;
  const showLimit = sl !== null && sl.daily_limit > 0;

  const pct = showLimit && sl ? Math.min((sl.spent_today / sl.daily_limit) * 100, 100) : 0;
  const atLimit = pct >= 100;
  const nearLimit = pct >= 80 && !atLimit;
  const barColor = atLimit ? "bg-red-500" : nearLimit ? "bg-amber-500" : "bg-emerald-500";
  const remainColor = atLimit ? "text-red-600" : nearLimit ? "text-amber-600" : "text-emerald-600";

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-red-50 via-white to-red-50 flex flex-col items-center justify-center px-12 gap-8">
      <XCircle className="h-32 w-32 text-red-500" strokeWidth={2} />
      <h1 className="text-6xl font-extrabold text-zinc-900">Payment Failed</h1>
      <p className="text-2xl text-red-700 font-medium max-w-2xl text-center">{reason}</p>

      {showLimit && sl && (
        <div className="w-full max-w-xl bg-white rounded-2xl border border-red-100 shadow-sm p-6 space-y-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Daily Spending Limit — {sl.group_name}
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-xs text-zinc-500 mb-1">Daily Limit</div>
              <div className="text-2xl font-bold tabular-nums text-zinc-800">
                ฿{sl.daily_limit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-zinc-500 mb-1">Spent Today</div>
              <div className="text-2xl font-bold tabular-nums text-orange-500">
                ฿{sl.spent_today.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-zinc-500 mb-1">Remaining</div>
              <div className={cn("text-2xl font-bold tabular-nums", remainColor)}>
                ฿{sl.remaining.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
          </div>
          <div className="w-full h-3 rounded-full bg-zinc-100 overflow-hidden">
            <div className={cn("h-full rounded-full", barColor)} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <p className="text-base text-zinc-500">Please ask the cashier to try again.</p>
    </div>
  );
}
