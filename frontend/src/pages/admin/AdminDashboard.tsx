/**
 * Admin Dashboard — at-a-glance overview for admins landing on `/admin`.
 *
 * Layout:
 *   1. Header (page title + live date)
 *   2. KPI row (3 cards): Canteen sales today, Store sales today, Low stock alerts
 *   3. Quick Actions: Store Management, Manage Users, Reports
 *   4. Recent Activity (last 10 receipts)
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
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

// Receipts from /pos/receipt may include shop_id (backend model supports it
// even though the typed `Receipt` schema doesn't expose it yet).
type ReceiptRow = Receipt & {
  shop_id?: string | null;
  created_by_name?: string | null;
  payer_label?: string | null;
  payment_method?: string | null;
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "เงินสด",
  wallet: "Wallet",
  card_tap: "แตะบัตร",
  credit_card: "บัตรเครดิต",
  debit_card: "บัตรเดบิต",
  edc: "EDC",
  bank_transfer: "โอนเงิน",
  department: "ตัดงบ",
  other: "อื่นๆ",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const formatTHB = (n: number) =>
  new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
  }).format(n);

const formatDateLong = (d: Date, lang: string) =>
  d.toLocaleDateString(lang === "th" ? "th-TH" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const isToday = (iso: string): boolean => {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
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
): { className: string; label: string } => {
  const id = (shopId ?? "").toLowerCase();
  switch (id) {
    case "canteen":
      return {
        className: "border-amber-300 bg-amber-100 text-amber-800",
        label: t("admin.dashboard.shopCanteen"),
      };
    case "coop":
      return {
        className: "border-orange-300 bg-orange-100 text-orange-800",
        label: t("admin.dashboard.shopCoop"),
      };
    case "sports":
      return {
        className: "border-emerald-300 bg-emerald-100 text-emerald-800",
        label: t("admin.dashboard.shopSports"),
      };
    case "bookstore":
      return {
        className: "border-indigo-300 bg-indigo-100 text-indigo-800",
        label: t("admin.dashboard.shopBookstore"),
      };
    default:
      return {
        className: "border-muted-foreground/20 bg-muted text-muted-foreground",
        label: shopId || "—",
      };
  }
};

// Guess canteen/store bucket from a receipt. Prefers explicit shop_id, falls
// back to receipt_number prefix conventions.
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

// ── KPI queries ──────────────────────────────────────────────────────────────

const STALE = 30_000;

function useRecentReceipts() {
  return useQuery<ReceiptRow[]>({
    queryKey: ["admin", "dashboard", "recent-receipts"],
    queryFn: () => api.get<ReceiptRow[]>("/pos/receipt?page=1"),
    staleTime: STALE,
    refetchInterval: 30_000,
  });
}

function useTodaySales() {
  // Pull a larger chunk to filter for today's activity for KPI.
  return useQuery<ReceiptRow[]>({
    queryKey: ["admin", "dashboard", "sales-today"],
    queryFn: () => api.get<ReceiptRow[]>("/pos/receipt?page=1"),
    staleTime: STALE,
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
  });
}

function useLowStockItems(enabled: boolean) {
  return useQuery<LowStockItem[]>({
    queryKey: ["admin", "dashboard", "low-stock-items"],
    queryFn: () => api.get<LowStockItem[]>("/shops/low-stock"),
    enabled,
    staleTime: STALE,
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

// ── Main component ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { t, i18n } = useTranslation();
  const salesQuery = useTodaySales();
  const lowStockQuery = useLowStockAggregate();
  const receiptsQuery = useRecentReceipts();
  const [showLowStock, setShowLowStock] = useState(false);
  const lowStockItemsQuery = useLowStockItems(showLowStock);
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | null>(null);

  // Derive today's canteen / store totals from whatever receipts we've fetched.
  const canteenTotal = salesQuery.data
    ?.filter((r) => r.status === "active" && isToday(r.created_at))
    .filter((r) => bucketFromReceipt(r) === "canteen")
    .reduce((sum, r) => sum + (r.total ?? 0), 0);

  const storeTotal = salesQuery.data
    ?.filter((r) => r.status === "active" && isToday(r.created_at))
    .filter((r) => bucketFromReceipt(r) === "store")
    .reduce((sum, r) => sum + (r.total ?? 0), 0);

  const todaysReceiptCount = salesQuery.data?.filter((r) =>
    isToday(r.created_at),
  ).length;

  const recent = (receiptsQuery.data ?? []).slice(0, 10);

  return (
    <div className="page-shell">
      {/* Row 1 — Header */}
      <div className="page-header">
        <h1 className="page-title">{t("admin.dashboard.title")}</h1>
        <p className="page-description">
          {t("admin.dashboard.todayPrefix")} — {formatDateLong(new Date(), i18n.language)}
        </p>
      </div>

      {/* Row 2 — KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard
          label={t("admin.dashboard.canteenSalesToday")}
          value={
            canteenTotal !== undefined ? formatTHB(canteenTotal) : null
          }
          subtext={
            todaysReceiptCount !== undefined
              ? t("admin.dashboard.receiptsTodayCount", { count: todaysReceiptCount })
              : undefined
          }
          valueClassName="text-amber-700"
          icon={<UtensilsCrossed className="h-4 w-4" />}
          loading={salesQuery.isLoading}
        />
        <KpiCard
          label={t("admin.dashboard.storeSalesToday")}
          value={storeTotal !== undefined ? formatTHB(storeTotal) : null}
          subtext={t("admin.dashboard.storeSalesSubtext")}
          valueClassName="text-orange-700"
          icon={<Store className="h-4 w-4" />}
          loading={salesQuery.isLoading}
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

      {/* Row 3 — Quick Actions */}
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

      {/* Row 4 — Recent Activity */}
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
                  <TableHead>{t("admin.dashboard.colCashier", "ผู้ขาย")}</TableHead>
                  <TableHead>{t("admin.dashboard.colPayment", "วิธีชำระ")}</TableHead>
                  <TableHead>{t("admin.dashboard.colBuyer", "ผู้ซื้อ")}</TableHead>
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
                  const badge = shopBadgeVariant(sid, t);
                  const pmLabel = r.payment_method
                    ? (PAYMENT_METHOD_LABELS[r.payment_method] ?? r.payment_method)
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
