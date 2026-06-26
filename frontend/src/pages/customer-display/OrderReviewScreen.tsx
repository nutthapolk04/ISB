/**
 * Order Review — shown the moment the cashier opens the payment modal.
 * Lets the customer verify line items and total before committing.
 */
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
          <div className="max-w-3xl mx-auto mt-3 text-amber-50 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Paying as <b>{payer.name}</b>{payer.role ? ` · ${payer.role}` : ""}</span>
            {payer.spendingLimit && payer.spendingLimit.daily_limit > 0 && (
              <span className="bg-amber-400/40 rounded-full px-3 py-0.5 text-xs font-medium tabular-nums">
                Remaining ฿{payer.spendingLimit.remaining.toLocaleString(undefined, { maximumFractionDigits: 0 })} / ฿{payer.spendingLimit.daily_limit.toLocaleString(undefined, { maximumFractionDigits: 0 })} today
              </span>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}
