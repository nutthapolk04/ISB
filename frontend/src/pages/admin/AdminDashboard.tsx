/**
 * Admin Dashboard — at-a-glance overview for admins landing on `/admin`.
 *
 * Layout:
 *   1. Header (page title + date range filter)
 *   2. KPI row (3 cards): Canteen sales, Store sales, Low stock alerts — all follow date range
 *   3. Per-Shop Daily Summary — sales totals broken out per shop for selected range
 *   4. Quick Actions: Store Management, Manage Users, Reports
 *   5. Recent Activity (last 10 receipts — live, independent of date range)
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { format } from "date-fns";
import {
  UtensilsCrossed,
  Store,
  UserCog,
  BarChart3,
  AlertTriangle,
  Receipt as ReceiptIcon,
  ChevronRight,
} from "lucide-react";

import { api } from "@/lib/api";
import type { Receipt } from "@/types/receipt";
import { Card, CardContent } from "@/components/ui/card";
import { ReceiptDetailDialog } from "@/components/ReceiptDetailDialog";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ────────────────────────────────────────────────────────────────────

interface ShopApiResponse {
  id: string;
  name: string;
  is_active: boolean;
  module: "canteen" | "store";
}

interface ShopStats {
  total_products: number;
  low_stock_count: number;
  total_value: number;
}

interface LowStockItem {
  id: number;
  shop_id: string;
  shop_name: string;
  product_code: string;
  name: string;
  stock: number;
  min_stock: number;
  category: string;
}

interface SalesByPaymentReport {
  date_from: string;
  date_to: string;
  shop_id: string | null;
  rows: { payment_method: string; receipt_count: number; total: number }[];
  grand_total: number;
  total_receipts: number;
}

interface ShopSummary {
  shop: ShopApiResponse;
  total: number;
  receipts: number;
}

// Receipts from /pos/receipt may include shop_id (backend model supports it
// even though the typed `Receipt` schema doesn't expose it yet).
type ReceiptRow = Receipt & {
  shop_id?: string | null;
  created_by_name?: string | null;
  payer_label?: string | null;
  payment_method?: string | null;
};


// ── Helpers ──────────────────────────────────────────────────────────────────

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
  }).format(n);

const todayIso = () => format(new Date(), "yyyy-MM-dd");

const formatDateLong = (d: Date, _lang: string) =>
  d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const formatDateRangeLabel = (from: string, to: string, _lang: string): string => {
  if (!from || !to) return "—";
  const f = new Date(from);
  const tt = new Date(to);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  if (from === to) return fmt(f);
  return `${fmt(f)} — ${fmt(tt)}`;
};

const formatRelative = (iso: string, t: TFunction): string => {
  const ts = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return t("admin.dashboard.secondsAgo", { count: diffSec });
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t("admin.dashboard.minutesAgo", { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t("admin.dashboard.hoursAgo", { count: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  return t("admin.dashboard.daysAgo", { count: diffDay });
};

const CANTEEN_IDS = new Set(["canteen"]);
const STORE_IDS = new Set(["coop", "sports", "bookstore", "store"]);

const shopBadgeVariant = (
  shopId: string | null | undefined,
  t: TFunction,
  shopMap: Record<string, string> = {},
): { className: string; label: string } => {
  const id = (shopId ?? "").toLowerCase();
  switch (id) {
    case "canteen":
      return {
        className: "border-amber-300 bg-amber-100 text-amber-800",
        label: shopMap[id] ?? t("admin.dashboard.shopCanteen"),
      };
    case "coop":
      return {
        className: "border-orange-300 bg-orange-100 text-orange-800",
        label: shopMap[id] ?? t("admin.dashboard.shopCoop"),
      };
    case "sports":
      return {
        className: "border-emerald-300 bg-emerald-100 text-emerald-800",
        label: shopMap[id] ?? t("admin.dashboard.shopSports"),
      };
    case "bookstore":
      return {
        className: "border-indigo-300 bg-indigo-100 text-indigo-800",
        label: shopMap[id] ?? t("admin.dashboard.shopBookstore"),
      };
    default:
      return {
        className: "border-muted-foreground/20 bg-muted text-muted-foreground",
        label: shopMap[id] ?? shopId ?? "—",
      };
  }
};

// Guess canteen/store bucket from a receipt for the Recent Activity badge
// fallback when shop_id isn't populated.
const bucketFromReceipt = (r: ReceiptRow): "canteen" | "store" | "other" => {
  const sid = (r.shop_id ?? "").toLowerCase();
  if (CANTEEN_IDS.has(sid)) return "canteen";
  if (STORE_IDS.has(sid)) return "store";
  const num = (r.receipt_number ?? "").toUpperCase();
  if (num.startsWith("C-") || num.startsWith("CANTEEN")) return "canteen";
  if (
    num.startsWith("S-") ||
    num.startsWith("STORE") ||
    num.startsWith("R-")
  ) {
    return "store";
  }
  return "other";
};

// ── Queries ──────────────────────────────────────────────────────────────────

const STALE = 30_000;

function useRecentReceipts() {
  return useQuery<ReceiptRow[]>({
    queryKey: ["admin", "dashboard", "recent-receipts"],
    queryFn: () => api.get<ReceiptRow[]>("/pos/receipt?page=1"),
    staleTime: STALE,
    refetchInterval: STALE,
    refetchOnWindowFocus: true,
  });
}

function useShops() {
  return useQuery<ShopApiResponse[]>({
    queryKey: ["shops", "active"],
    queryFn: () => api.get<ShopApiResponse[]>("/shops/?active_only=true"),
    staleTime: 5 * 60_000,
  });
}

function usePerShopSummary(
  shops: ShopApiResponse[] | undefined,
  dateFrom: string,
  dateTo: string,
) {
  return useQuery<ShopSummary[]>({
    queryKey: ["admin", "dashboard", "per-shop-summary", dateFrom, dateTo],
    queryFn: async () => {
      if (!shops?.length) return [];
      const results = await Promise.all(
        shops.map(async (s) => {
          try {
            const r = await api.get<SalesByPaymentReport>(
              `/reports/sales-by-payment?shop_id=${encodeURIComponent(s.id)}&date_from=${dateFrom}&date_to=${dateTo}`,
            );
            return {
              shop: s,
              total: r.grand_total ?? 0,
              receipts: r.total_receipts ?? 0,
            };
          } catch {
            return { shop: s, total: 0, receipts: 0 };
          }
        }),
      );
      return results;
    },
    enabled: !!shops?.length && !!dateFrom && !!dateTo,
    staleTime: STALE,
    refetchInterval: STALE,
    refetchOnWindowFocus: true,
  });
}

function useLowStockAggregate() {
  return useQuery<number | null>({
    queryKey: ["admin", "dashboard", "low-stock"],
    queryFn: async () => {
      try {
        const shops = await api.get<ShopApiResponse[]>(
          "/shops/?active_only=true",
        );
        const stats = await Promise.all(
          shops.map(async (s) => {
            try {
              return await api.get<ShopStats>(`/shops/${s.id}/stats`);
            } catch {
              return { total_products: 0, low_stock_count: 0, total_value: 0 };
            }
          }),
        );
        return stats.reduce((sum, s) => sum + (s.low_stock_count ?? 0), 0);
      } catch {
        return null;
      }
    },
    staleTime: STALE,
    refetchInterval: STALE,
    refetchOnWindowFocus: true,
  });
}

function useLowStockItems(enabled: boolean) {
  return useQuery<LowStockItem[]>({
    queryKey: ["admin", "dashboard", "low-stock-items"],
    queryFn: () => api.get<LowStockItem[]>("/shops/low-stock"),
    enabled,
    staleTime: STALE,
    refetchInterval: STALE,
    refetchOnWindowFocus: true,
  });
}

// ── KPI card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string | null;
  subtext?: string;
  valueClassName?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  onClick?: () => void;
}

function KpiCard({
  label,
  value,
  subtext,
  valueClassName,
  icon,
  loading,
  onClick,
}: KpiCardProps) {
  return (
    <Card
      className={`kpi-card${onClick ? " cursor-pointer transition-shadow hover:shadow-md" : ""}`}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="kpi-label">{label}</div>
          <div className="flex items-center gap-1 text-muted-foreground">
            {icon}
            {onClick && <ChevronRight className="h-3 w-3 opacity-50" />}
          </div>
        </div>
        {loading ? (
          <Skeleton className="mt-2 h-8 w-28" />
        ) : (
          <div className={`kpi-value mt-1 ${valueClassName ?? ""}`}>
            {value ?? "—"}
          </div>
        )}
        {subtext && (
          <div className="mt-1 text-xs text-muted-foreground">{subtext}</div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Quick action card ────────────────────────────────────────────────────────

interface QuickActionProps {
  to: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge?: { text: string; tone: "amber" | "emerald" | "rose" | "indigo" };
}

const badgeToneClass: Record<NonNullable<QuickActionProps["badge"]>["tone"], string> = {
  amber: "border-amber-300 bg-amber-100 text-amber-800",
  emerald: "border-emerald-300 bg-emerald-100 text-emerald-800",
  rose: "border-rose-300 bg-rose-100 text-rose-800",
  indigo: "border-indigo-300 bg-indigo-100 text-indigo-800",
};

function QuickActionCard({ to, icon, title, subtitle, badge }: QuickActionProps) {
  return (
    <Card className="interactive-card">
      <Link to={to} className="block p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-shrink-0 rounded-lg bg-muted p-2.5">{icon}</div>
          {badge && (
            <Badge className={badgeToneClass[badge.tone]}>{badge.text}</Badge>
          )}
        </div>
        <div className="mt-3 text-base font-semibold tracking-tight">
          {title}
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>
      </Link>
    </Card>
  );
}

// ── Date range presets ───────────────────────────────────────────────────────

type Preset = "today" | "yesterday" | "last7" | "month";

function presetRange(preset: Preset): { from: string; to: string } {
  const today = new Date();
  const iso = (d: Date) => format(d, "yyyy-MM-dd");
  switch (preset) {
    case "today":
      return { from: iso(today), to: iso(today) };
    case "yesterday": {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { from: iso(y), to: iso(y) };
    }
    case "last7": {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { from: iso(start), to: iso(today) };
    }
    case "month": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: iso(start), to: iso(today) };
    }
  }
}

// ── Main component ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { t, i18n } = useTranslation();

  const [dateFrom, setDateFrom] = useState<string>(todayIso());
  const [dateTo, setDateTo] = useState<string>(todayIso());

  const shopsQuery = useShops();
  const perShopQuery = usePerShopSummary(shopsQuery.data, dateFrom, dateTo);
  const lowStockQuery = useLowStockAggregate();
  const receiptsQuery = useRecentReceipts();

  const [showLowStock, setShowLowStock] = useState(false);
  const lowStockItemsQuery = useLowStockItems(showLowStock);
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | null>(null);

  // Shop id → display name (lower-cased keys) for badges.
  const shopMap: Record<string, string> = Object.fromEntries(
    (shopsQuery.data ?? []).map((s) => [s.id.toLowerCase(), s.name]),
  );

  // Aggregate per-shop into module totals + grand totals.
  const aggregates = useMemo(() => {
    const rows = perShopQuery.data ?? [];
    let canteenTotal = 0;
    let storeTotal = 0;
    let totalReceipts = 0;
    let grandTotal = 0;
    for (const r of rows) {
      grandTotal += r.total;
      totalReceipts += r.receipts;
      if (r.shop.module === "canteen") canteenTotal += r.total;
      else storeTotal += r.total;
    }
    return { canteenTotal, storeTotal, totalReceipts, grandTotal };
  }, [perShopQuery.data]);

  // Per-shop rows sorted by total desc.
  const perShopRows = useMemo(
    () => (perShopQuery.data ?? []).slice().sort((a, b) => b.total - a.total),
    [perShopQuery.data],
  );

  const recent = (receiptsQuery.data ?? []).slice(0, 10);
  const rangeLabel = formatDateRangeLabel(dateFrom, dateTo, i18n.language);
  const summaryLoading = perShopQuery.isLoading || shopsQuery.isLoading;

  const applyPreset = (p: Preset) => {
    const r = presetRange(p);
    setDateFrom(r.from);
    setDateTo(r.to);
  };

  return (
    <div className="page-shell">
      {/* Row 1 — Header */}
      <div className="page-header">
        <h1 className="page-title">{t("admin.dashboard.title")}</h1>
        <p className="page-description">
          {formatDateLong(new Date(), i18n.language)}
        </p>
      </div>

      {/* Date range filter */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <span className="text-sm font-medium">
              {t("admin.dashboard.dateRange")}
            </span>
            <DateRangePicker
              startDate={dateFrom}
              endDate={dateTo}
              onStartChange={setDateFrom}
              onEndChange={setDateTo}
              className="w-full sm:w-[280px]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => applyPreset("today")}
            >
              {t("admin.dashboard.today")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => applyPreset("yesterday")}
            >
              {t("admin.dashboard.yesterday")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => applyPreset("last7")}
            >
              {t("admin.dashboard.last7Days")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => applyPreset("month")}
            >
              {t("admin.dashboard.thisMonth")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Row 2 — KPIs (follow selected date range) */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiCard
          label={t("admin.dashboard.canteenSales")}
          value={summaryLoading ? null : formatTHB(aggregates.canteenTotal)}
          subtext={rangeLabel}
          valueClassName="text-amber-700"
          icon={<UtensilsCrossed className="h-4 w-4" />}
          loading={summaryLoading}
        />
        <KpiCard
          label={t("admin.dashboard.storeSales")}
          value={summaryLoading ? null : formatTHB(aggregates.storeTotal)}
          subtext={
            summaryLoading
              ? rangeLabel
              : t("admin.dashboard.receiptsInRange", {
                  count: aggregates.totalReceipts,
                })
          }
          valueClassName="text-orange-700"
          icon={<Store className="h-4 w-4" />}
          loading={summaryLoading}
        />
        <KpiCard
          label={t("admin.dashboard.lowStockAlerts")}
          value={
            lowStockQuery.data === null
              ? "—"
              : lowStockQuery.data !== undefined
                ? String(lowStockQuery.data)
                : null
          }
          subtext={t("admin.dashboard.acrossAllShops")}
          valueClassName="text-rose-700"
          icon={<AlertTriangle className="h-4 w-4" />}
          loading={lowStockQuery.isLoading}
          onClick={() => setShowLowStock(true)}
        />
      </div>

      {/* Low stock detail dialog */}
      <Dialog open={showLowStock} onOpenChange={setShowLowStock}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-700">
              <AlertTriangle className="h-4 w-4" />
              {t("admin.dashboard.lowStockAlerts")}
            </DialogTitle>
          </DialogHeader>
          {lowStockItemsQuery.isLoading ? (
            <div className="space-y-2 py-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : !lowStockItemsQuery.data?.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("admin.dashboard.noLowStock", "ไม่มีสินค้าต่ำกว่าขั้นต่ำ")}
            </p>
          ) : (
            <div className="max-h-[60vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("inventory.colName", "ชื่อสินค้า")}</TableHead>
                    <TableHead>{t("inventory.colShop", "ร้าน")}</TableHead>
                    <TableHead>{t("inventory.colCategory", "หมวด")}</TableHead>
                    <TableHead className="text-right">{t("inventory.colStock", "คงเหลือ")}</TableHead>
                    <TableHead className="text-right">{t("inventory.colMinStock", "ขั้นต่ำ")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowStockItemsQuery.data.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        <div>{item.name}</div>
                        <div className="text-xs text-muted-foreground">{item.product_code}</div>
                      </TableCell>
                      <TableCell>{item.shop_name}</TableCell>
                      <TableCell>{item.category}</TableCell>
                      <TableCell className="text-right font-semibold text-rose-700">
                        {item.stock}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {item.min_stock}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Row 3 — Per-Shop Daily Summary */}
      <Card>
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">
                {t("admin.dashboard.perShopSummary")}
              </h2>
            </div>
            <span className="text-xs text-muted-foreground">{rangeLabel}</span>
          </div>

          {summaryLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.dashboard.colShopName")}</TableHead>
                  <TableHead>{t("admin.dashboard.colModule")}</TableHead>
                  <TableHead className="text-right">
                    {t("admin.dashboard.colReceiptCount")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("admin.dashboard.colTotal")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perShopRows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-muted-foreground"
                    >
                      {t("admin.dashboard.noShopData")}
                    </TableCell>
                  </TableRow>
                )}
                {perShopRows.map((row) => {
                  const badge = shopBadgeVariant(row.shop.id, t, shopMap);
                  return (
                    <TableRow key={row.shop.id}>
                      <TableCell className="font-medium">
                        <Badge variant="outline" className={badge.className}>
                          {row.shop.name}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.shop.module === "canteen"
                          ? t("admin.dashboard.moduleCanteen")
                          : t("admin.dashboard.moduleStore")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.receipts}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-emerald-700">
                        {formatTHB(row.total)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {perShopRows.length > 0 && (
                  <TableRow className="border-t-2 bg-muted/40">
                    <TableCell colSpan={2} className="font-semibold">
                      {t("admin.dashboard.summaryGrandTotal")}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {aggregates.totalReceipts}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-emerald-800">
                      {formatTHB(aggregates.grandTotal)}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Row 4 — Quick Actions */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("admin.dashboard.quickActions")}
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <QuickActionCard
            to="/store/management"
            icon={<Store className="h-5 w-5 text-amber-600" />}
            title={t("admin.dashboard.storeManagement")}
            subtitle={t("admin.dashboard.storeManagementSubtitle")}
          />
          <QuickActionCard
            to="/users"
            icon={<UserCog className="h-5 w-5 text-indigo-600" />}
            title={t("admin.dashboard.manageUsers")}
            subtitle={t("admin.dashboard.manageUsersSubtitle")}
          />
          <QuickActionCard
            to="/admin/reports"
            icon={<BarChart3 className="h-5 w-5 text-rose-600" />}
            title={t("admin.dashboard.reports")}
            subtitle={t("admin.dashboard.reportsSubtitle")}
          />
        </div>
      </div>

      {/* Row 5 — Recent Activity */}
      <Card>
        <CardContent className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <ReceiptIcon className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">{t("admin.dashboard.recentActivity")}</h2>
            <span className="text-xs text-muted-foreground">
              {t("admin.dashboard.recentLast10")}
            </span>
          </div>

          {receiptsQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.dashboard.colTime")}</TableHead>
                  <TableHead>{t("admin.dashboard.colReceipt")}</TableHead>
                  <TableHead>{t("admin.dashboard.colShop")}</TableHead>
                  <TableHead>{t("admin.dashboard.colCashier")}</TableHead>
                  <TableHead>{t("admin.dashboard.colPayment")}</TableHead>
                  <TableHead>{t("admin.dashboard.colBuyer")}</TableHead>
                  <TableHead className="text-right">{t("admin.dashboard.colAmount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-muted-foreground"
                    >
                      {t("admin.dashboard.noRecentActivity")}
                    </TableCell>
                  </TableRow>
                )}
                {recent.map((r) => {
                  const sid =
                    r.shop_id ??
                    (bucketFromReceipt(r) === "canteen"
                      ? "canteen"
                      : bucketFromReceipt(r) === "store"
                        ? "coop"
                        : null);
                  const badge = shopBadgeVariant(sid, t, shopMap);
                  const pmLabel = r.payment_method
                    ? t(`common.paymentMethods.${r.payment_method}`, r.payment_method)
                    : "—";
                  const isVoided = r.status === "voided";
                  return (
                    <TableRow
                      key={r.id}
                      className={`cursor-pointer transition-colors ${
                        isVoided
                          ? "bg-rose-50/60 hover:bg-rose-100/60 text-rose-700"
                          : "hover:bg-emerald-50/40"
                      }`}
                      onClick={() => setSelectedReceiptId(r.id)}
                    >
                      <TableCell className="text-sm text-muted-foreground">
                        {formatRelative(r.created_at, t)}
                      </TableCell>
                      <TableCell className={`font-mono text-sm ${isVoided ? "line-through opacity-60" : ""}`}>
                        {r.receipt_number}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={badge.className}>
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.created_by_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {pmLabel}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.payer_label ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        <span className={isVoided ? "line-through opacity-60" : "text-emerald-700"}>
                          {formatTHB(r.total)}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <ReceiptDetailDialog
        receiptId={selectedReceiptId}
        onClose={() => setSelectedReceiptId(null)}
      />
    </div>
  );
}
