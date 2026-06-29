/**
 * SpendingLimitChip
 *
 * Shows "Today's remaining" for BOTH Canteen and Store on a single panel.
 * Reads daily_limit_* and spent_today_* directly from the selected member
 * (no API call needed in the steady state). After a successful checkout
 * the parent bumps `refreshKey` and the chip re-fetches the member so
 * spent_today reflects the latest receipts.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface Member {
  id: number;
  customer_kind?: string | null;
  user_id?: number | null;
  daily_limit_canteen?: number | null;
  spent_today_canteen?: number | null;
  daily_limit_store?: number | null;
  spent_today_store?: number | null;
}

interface Props {
  /** Currently selected member (or null when no one is scanned). */
  member: Member | null;
  /** Bump to force a fresh /customers/{id} fetch (e.g. after checkout). */
  refreshKey?: number;
}

const fmt = (n: number | null | undefined) =>
  "฿" + (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function LimitRow({ label, limit, spent }: { label: string; limit: number; spent: number }) {
  const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
  const atLimit = pct >= 100;
  const nearLimit = pct >= 80 && !atLimit;
  const text = atLimit ? "text-red-700 font-bold" : nearLimit ? "text-amber-700 font-semibold" : "";
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className={cn("font-mono tabular-nums", text)}>
          {fmt(spent)} <span className="text-muted-foreground">/</span> {fmt(limit)}
        </span>
      </div>
      <Progress
        value={pct}
        className={cn(
          "h-1.5",
          atLimit ? "[&>div]:bg-red-500" : nearLimit ? "[&>div]:bg-amber-500" : "[&>div]:bg-primary",
        )}
      />
    </div>
  );
}

export function SpendingLimitChip({ member, refreshKey = 0 }: Props) {
  const { t } = useTranslation();
  const [latest, setLatest] = useState<Member | null>(member);

  // Keep state in sync with the prop (parent re-selecting a member etc.)
  useEffect(() => {
    setLatest(member);
  }, [member]);

  // After checkout (refreshKey bumps), re-fetch the customer so spent_today
  // reflects the freshly created receipt.
  useEffect(() => {
    if (refreshKey === 0) return;
    if (!member?.id) return;
    if (member.user_id != null || member.customer_kind === "department") return;
    api
      .get<Member>(`/customers/${member.id}`)
      .then(setLatest)
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (!latest) return null;
  // Users (parent/staff) and Departments don't carry per-shop daily limits.
  if (latest.user_id != null || latest.customer_kind === "department") return null;

  const ct = latest.daily_limit_canteen ?? null;
  const st = latest.daily_limit_store ?? null;
  if (ct == null && st == null) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs space-y-2">
      <div className="font-medium text-foreground">{t("pos.todayRemaining", "Today's remaining")}</div>
      {ct != null && <LimitRow label="Canteen" limit={Number(ct)} spent={Number(latest.spent_today_canteen ?? 0)} />}
      {st != null && <LimitRow label="Store" limit={Number(st)} spent={Number(latest.spent_today_store ?? 0)} />}
    </div>
  );
}
