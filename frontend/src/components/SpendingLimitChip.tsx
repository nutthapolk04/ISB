/**
 * SpendingLimitChip
 *
 * Shows "Today's remaining" for the current shop's spending group after a
 * customer is scanned. Used in both Canteen.tsx and Store.tsx.
 *
 * Props:
 *  - shopId: the POS shop id (used to resolve the spending_group_id)
 *  - payerId: { kind: "customer" | "user", id: number } — null = not scanned yet
 *  - refreshKey: increment this to trigger a re-fetch (e.g. after checkout)
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface Props {
  shopId: string;
  payerId: { kind: "customer" | "user"; id: number } | null;
  refreshKey?: number;
}

interface UsageData {
  spending_group_id: number;
  code: string;
  name_en: string;
  name_th: string;
  daily_limit: number;
  spent_today: number;
  remaining: number;
}

interface ShopData {
  spending_group_id: number | null;
}

const formatTHB = (n: number) =>
  "฿" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function SpendingLimitChip({ shopId, payerId, refreshKey = 0 }: Props) {
  const { t, i18n } = useTranslation();
  const [groupId, setGroupId] = useState<number | null | undefined>(undefined);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);

  // Step 1: resolve the shop's spending_group_id once
  useEffect(() => {
    api
      .get<ShopData>(`/shops/${shopId}`)
      .then((s) => setGroupId(s.spending_group_id))
      .catch(() => setGroupId(null));
  }, [shopId]);

  // Step 2: fetch usage whenever payer changes or refreshKey bumps
  useEffect(() => {
    if (!payerId || groupId == null || groupId === null) {
      setUsage(null);
      return;
    }
    setLoading(true);
    const params =
      payerId.kind === "customer"
        ? `payer_customer_id=${payerId.id}`
        : `payer_user_id=${payerId.id}`;
    api
      .get<UsageData>(`/spending-groups/${groupId}/usage-today?${params}`)
      .then((data) => setUsage(data))
      .catch(() => setUsage(null))
      .finally(() => setLoading(false));
  }, [groupId, payerId, refreshKey]);

  // Don't render anything if customer not scanned yet, or group not found
  if (!payerId || groupId == null || groupId === null) return null;
  if (loading && !usage) return null;
  if (!usage) return null;

  const pct = usage.daily_limit > 0 ? (usage.spent_today / usage.daily_limit) * 100 : 0;
  const atLimit = pct >= 100;
  const nearLimit = pct >= 80 && !atLimit;
  const groupName = i18n.language === "th" ? usage.name_th : usage.name_en;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs space-y-1",
        atLimit
          ? "border-red-300 bg-red-50 text-red-800"
          : nearLimit
          ? "border-amber-300 bg-amber-50 text-amber-800"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{t("pos.todayRemaining")}</span>
        <span className={cn("font-mono tabular-nums", atLimit ? "text-red-700 font-bold" : "")}>
          {t("pos.todayUsedOf", {
            spent: formatTHB(usage.spent_today),
            limit: formatTHB(usage.daily_limit),
          })}
        </span>
      </div>
      <Progress
        value={Math.min(pct, 100)}
        className={cn(
          "h-1.5",
          atLimit ? "[&>div]:bg-red-500" : nearLimit ? "[&>div]:bg-amber-500" : "[&>div]:bg-primary",
        )}
      />
      <p className="text-[0.65rem] opacity-70">{groupName}</p>
    </div>
  );
}
