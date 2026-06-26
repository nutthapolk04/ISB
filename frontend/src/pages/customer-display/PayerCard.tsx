/**
 * PayerCard — shared between Processing and Success screens.
 * Shows the payer's identity + balance preview for wallet / card /
 * department transactions. Customer photo is intentionally omitted
 * (privacy in a queue).
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { DisplayPayer, SpendingLimitData } from "@/hooks/useDisplayBroadcast";

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

function LimitLine({ label, sl }: { label: string; sl: SpendingLimitData }) {
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

export function PayerCard({ payer, total, successful = false }: Props) {
  const showBalance = payer.balanceBefore !== null;
  const canteen = payer.canteenLimit && payer.canteenLimit.daily_limit > 0 ? payer.canteenLimit : null;
  const store = payer.storeLimit && payer.storeLimit.daily_limit > 0 ? payer.storeLimit : null;
  const showLimits = payer.kind !== "department" && (canteen || store);

  const afterClass = cn(
    "tabular-nums font-bold",
    successful
      ? "text-emerald-600"
      : payer.balanceAfter !== null && payer.balanceAfter < 0
        ? "text-red-600"
        : "text-zinc-900",
  );

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

      {/* Daily Spending Limit — compact lines */}
      {showLimits && (
        <div className={cn(showBalance ? "mt-6" : "")}>
          <SectionLabel>Daily Spending Limit</SectionLabel>
          <div className="space-y-3 pt-3">
            {canteen && <LimitLine label="Canteen" sl={canteen} />}
            {store && <LimitLine label="Store" sl={store} />}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
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
