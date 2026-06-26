/**
 * Order Review — shown the moment the cashier opens the payment modal.
 * Lets the customer verify line items and total before committing.
 */
import { cn } from "@/lib/utils";
import type { DisplayItem, DisplayPayer } from "@/hooks/useDisplayBroadcast";

interface Props {
  items: DisplayItem[];
  total: number;
  payer: DisplayPayer | null;
}

export function OrderReviewScreen({ items, total, payer }: Props) {
  return (
    <div className="h-screen w-screen bg-gradient-to-br from-amber-50/50 via-white to-orange-50/40 flex flex-col">
      {/* Header */}
      <header className="px-12 pt-10 pb-6 text-center">
        <h1 className="text-5xl font-extrabold text-zinc-900">Your Order</h1>
        <p className="mt-2 text-lg text-zinc-500">
          Please verify the items below
        </p>
      </header>

      {/* Items list */}
      <main className="flex-1 px-12 py-4 overflow-y-auto">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-amber-100">
          <table className="w-full">
            <thead className="border-b border-amber-100">
              <tr className="text-zinc-500 text-sm">
                <th className="px-6 py-3 text-left font-medium">Item</th>
                <th className="px-4 py-3 text-center font-medium w-20">Qty</th>
                <th className="px-6 py-3 text-right font-medium w-32">Price</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr
                  key={`${idx}-${item.name}`}
                  className="border-b border-amber-50 last:border-0"
                >
                  <td className="px-6 py-4 text-lg font-medium text-zinc-900">
                    {item.name}
                  </td>
                  <td className="px-4 py-4 text-center text-lg tabular-nums text-zinc-700">
                    ×{item.qty}
                  </td>
                  <td className="px-6 py-4 text-right text-lg font-semibold tabular-nums text-zinc-900">
                    ฿{item.price.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {/* Daily Spending Limit box — shown when payer has a personal limit */}
      {payer?.spendingLimit && payer.spendingLimit.daily_limit > 0 && (() => {
        const sl = payer.spendingLimit!;
        const pct = Math.min((sl.spent_today / sl.daily_limit) * 100, 100);
        const atLimit = pct >= 100;
        const nearLimit = pct >= 80 && !atLimit;
        const barColor = atLimit ? "bg-red-500" : nearLimit ? "bg-amber-500" : "bg-emerald-500";
        const remainColor = atLimit ? "text-red-600" : nearLimit ? "text-amber-600" : "text-emerald-600";
        return (
          <div className="px-12 pb-4">
            <div className="max-w-3xl mx-auto bg-white rounded-2xl border border-amber-100 shadow-sm p-6">
              <div className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-4">
                Daily Spending Limit
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-xs text-zinc-500 mb-1">Daily Limit</div>
                  <div className="text-2xl font-bold tabular-nums text-zinc-800">
                    ฿{sl.daily_limit.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-zinc-500 mb-1">Spent Today</div>
                  <div className="text-2xl font-bold tabular-nums text-orange-500">
                    ฿{sl.spent_today.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-zinc-500 mb-1">Remaining</div>
                  <div className={cn("text-2xl font-bold tabular-nums", remainColor)}>
                    ฿{sl.remaining.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </div>
                </div>
              </div>
              <div className="w-full h-3 rounded-full bg-zinc-100 overflow-hidden">
                <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-xs text-zinc-400">{sl.group_name}</span>
                <span className="text-xs text-zinc-400 tabular-nums">{Math.round(pct)}% used</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Total bar — hero metric */}
      <footer className="bg-amber-500 text-white px-12 py-8">
        <div className="max-w-3xl mx-auto flex items-baseline justify-between">
          <span className="text-2xl font-medium">Total</span>
          <span className="text-6xl font-extrabold tabular-nums">
            ฿
            {total.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        {payer && (
          <div className="max-w-3xl mx-auto mt-3 text-amber-50 text-sm">
            <span>Paying as <b>{payer.name}</b>{payer.role ? ` · ${payer.role}` : ""}</span>
          </div>
        )}
      </footer>
    </div>
  );
}
