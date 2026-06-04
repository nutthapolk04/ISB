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

export function PayerCard({ payer, total, successful = false }: Props) {
  const showBalance = payer.balanceBefore !== null;
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
      <div className="mb-6">
        <div className="text-3xl font-bold text-zinc-900">{payer.name}</div>
        <div className="mt-1 text-sm text-zinc-500">
          {[payer.role, payer.code ? `ID ${payer.code}` : null]
            .filter(Boolean)
            .join(" · ") || "—"}
        </div>
      </div>

      {showBalance && (
        <div className="space-y-3 border-t border-amber-100 pt-5">
          <Row label="Current Balance" value={fmt(payer.balanceBefore)} />
          <Row label="Amount Charged" value={fmt(-total)} negative />
          <Row label="Balance After" value={fmt(payer.balanceAfter)} valueClass={afterClass} bold />
        </div>
      )}
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
