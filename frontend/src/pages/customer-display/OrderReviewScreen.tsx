/**
 * Order Review — shown the moment the cashier opens the payment modal.
 * Lets the customer verify line items and total before committing.
 */
import { cn } from "@/lib/utils";
import type { DisplayItem, DisplayPayer, SpendingLimitData } from "@/hooks/useDisplayBroadcast";

interface Props {
  items: DisplayItem[];
  total: number;
  payer: DisplayPayer | null;
}

function LimitRow({ label, sl }: { label: string; sl: SpendingLimitData }) {
  const remaining = Math.max(0, sl.daily_limit - sl.spent_today);
  const remainingPct = sl.daily_limit > 0 ? Math.max(0, (remaining / sl.daily_limit) * 100) : 100;
  const atLimit = sl.spent_today >= sl.daily_limit;
  const nearLimit = remainingPct <= 20 && !atLimit;
  const color = atLimit ? "text-red-600" : nearLimit ? "text-amber-600" : "text-emerald-700";
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-base font-medium text-zinc-700">{label}</span>
        <span className={cn("text-lg font-bold tabular-nums", color)}>
          ฿{remaining.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          <span className="text-zinc-400 font-normal"> / </span>
          ฿{sl.daily_limit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      </div>
      <div className="w-full h-2 rounded-full bg-zinc-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${remainingPct}%`, backgroundColor: `hsl(${remainingPct * 1.2}, 75%, 45%)` }}
        />
      </div>
    </div>
  );
}

export function OrderReviewScreen({ items, total, payer }: Props) {
  const canteen = payer?.canteenLimit && payer.canteenLimit.daily_limit > 0 ? payer.canteenLimit : null;
  const store = payer?.storeLimit && payer.storeLimit.daily_limit > 0 ? payer.storeLimit : null;
  const hasLimits = canteen || store;

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

      {/* Daily Spending Limits — compact: Canteen ฿spent/฿limit / Store ฿spent/฿limit */}
      {hasLimits && (
        <div className="px-12 pb-4">
          <div className="max-w-3xl mx-auto bg-white rounded-2xl border border-amber-100 shadow-sm p-5 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
              Daily Spending remaining / limit
            </div>
            {canteen && <LimitRow label="Canteen" sl={canteen} />}
            {store && <LimitRow label="Store" sl={store} />}
          </div>
        </div>
      )}

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
