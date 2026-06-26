/**
 * PayerCard — shared between Processing and Success screens.
 * Shows the payer's identity + balance preview for wallet / card /
 * department transactions. Customer photo is intentionally omitted
 * (privacy in a queue).
 */
import { cn } from "@/lib/utils";
import type { DisplayPayer } from "@/hooks/useDisplayBroadcast";

interface Props {
  payer: DisplayPayer;
  total: number;
  /** Pass true on the success screen to highlight the new balance in green. */
  successful?: boolean;
}

function fmt(amount: number | null): string {
  if (amount === null) return "—";
  return (
    "฿" +
    amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function fmtInt(amount: number): string {
  return "฿" + amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function PayerCard({ payer, total, successful = false }: Props) {
  const showBalance = payer.balanceBefore !== null;
  const sl = payer.spendingLimit ?? null;
  const showSpendingLimit = sl !== null && payer.kind !== "department";

  const afterClass = cn(
    "tabular-nums font-bold",
    successful
      ? "text-emerald-600"
      : payer.balanceAfter !== null && payer.balanceAfter < 0
        ? "text-red-600"
        : "text-zinc-900",
  );

  const slPct = sl && sl.daily_limit > 0 ? Math.min((sl.spent_today / sl.daily_limit) * 100, 100) : 0;
  const slAtLimit = slPct >= 100;
  const slNearLimit = slPct >= 80 && !slAtLimit;
  const slBarColor = slAtLimit ? "bg-red-500" : slNearLimit ? "bg-amber-500" : "bg-emerald-500";
  const slRemainingColor = slAtLimit ? "text-red-600 font-bold" : slNearLimit ? "text-amber-600 font-semibold" : "text-emerald-600 font-bold";

  return (
    <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-8 max-w-xl mx-auto">
      {/* Identity */}
      <div className="mb-6">
        <div className="text-3xl font-bold text-zinc-900">{payer.name}</div>
        <div className="mt-1 text-sm text-zinc-500">
          {[payer.role, payer.code ? `ID ${payer.code}` : null]
            .filter(Boolean)
            .join(" · ") || "—"}
        </div>
      </div>

      {/* Wallet Balance section */}
      {showBalance && (
        <div>
          <SectionLabel>Wallet Balance</SectionLabel>
          <div className="space-y-3 pt-3">
            <Row label="Current Balance" value={fmt(payer.balanceBefore)} />
            <Row label="Amount Charged" value={fmt(-total)} negative />
            <Row label="Balance After" value={fmt(payer.balanceAfter)} valueClass={afterClass} bold />
          </div>
        </div>
      )}

      {/* Daily Spending Limit section */}
      {showSpendingLimit && sl && (
        <div className={cn(showBalance ? "mt-6" : "")}>
          <SectionLabel>Daily Spending Limit</SectionLabel>
          <div className="space-y-3 pt-3">
            <Row label="Daily Limit" value={fmtInt(sl.daily_limit)} />
            <Row label="Spent Today" value={fmtInt(sl.spent_today)} negative />
            <Row label="Remaining" value={fmtInt(sl.remaining)} valueClass={cn("tabular-nums font-bold", slRemainingColor)} bold />
          </div>
          {/* Progress bar */}
          <div className="mt-3">
            <div className="w-full h-2.5 rounded-full bg-zinc-100 overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", slBarColor)}
                style={{ width: `${slPct}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-xs text-zinc-400">{sl.group_name}</span>
              <span className={cn("text-xs tabular-nums", slAtLimit ? "text-red-500 font-semibold" : "text-zinc-400")}>
                {Math.round(slPct)}% used
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-t border-amber-100 pt-5">
      <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">{children}</span>
    </div>
  );
}

function Row({
  label,
  value,
  negative,
  bold,
  valueClass,
}: {
  label: string;
  value: string;
  negative?: boolean;
  bold?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={cn("text-zinc-600", bold && "text-zinc-900 font-semibold")}>
        {label}
      </span>
      <span
        className={cn(
          "text-2xl tabular-nums",
          bold ? "font-bold" : "font-medium",
          negative && !valueClass ? "text-orange-600" : "",
          valueClass,
        )}
      >
        {value}
      </span>
    </div>
  );
}
