import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, ShoppingBag, Calendar, CreditCard, Banknote, QrCode, Building2, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SalesReportData {
  rows: { product_name: string; quantity: number; total: number }[];
  grand_total: number;
  receipt_count: number;
}

interface SalesByPaymentRow {
  payment_method: string;
  receipt_count: number;
  total: number;
}

interface SalesByPaymentReportData {
  rows: SalesByPaymentRow[];
  grand_total: number;
  total_receipts: number;
  retail_total: number;
  department_total: number;
  department_receipts: number;
}

interface Shop {
  id: string;
  name: string;
  is_active: boolean;
  module: string;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function monthStartStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayLabel() {
  return new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number | undefined) {
  return (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type PaymentMethodKey = "wallet" | "cash" | "qr" | "edc" | "department" | string;

const METHOD_META: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; border: string; bar: string }> = {
  wallet: {
    label: "Wallet",
    icon: <Wallet className="h-3.5 w-3.5" />,
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
    bar: "bg-amber-400",
  },
  cash: {
    label: "Cash",
    icon: <Banknote className="h-3.5 w-3.5" />,
    color: "text-green-700",
    bg: "bg-green-50",
    border: "border-green-200",
    bar: "bg-green-400",
  },
  qr: {
    label: "QR Code",
    icon: <QrCode className="h-3.5 w-3.5" />,
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
    bar: "bg-blue-400",
  },
  edc: {
    label: "EDC / Card",
    icon: <CreditCard className="h-3.5 w-3.5" />,
    color: "text-purple-700",
    bg: "bg-purple-50",
    border: "border-purple-200",
    bar: "bg-purple-400",
  },
  department: {
    label: "Department",
    icon: <Building2 className="h-3.5 w-3.5" />,
    color: "text-indigo-700",
    bg: "bg-indigo-50",
    border: "border-indigo-200",
    bar: "bg-indigo-400",
  },
};

function getMethodMeta(method: PaymentMethodKey) {
  const key = method.toLowerCase();
  return METHOD_META[key] ?? {
    label: method.charAt(0).toUpperCase() + method.slice(1),
    icon: <CreditCard className="h-4 w-4" />,
    color: "text-gray-700",
    bg: "bg-gray-50",
    border: "border-gray-200",
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ShopDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const isAdmin = user?.activeRole === "admin" || user?.role === "admin";

  // ---------------------------------------------------------------------------
  // Shop list (admin only)
  // ---------------------------------------------------------------------------
  const { data: shops } = useQuery<Shop[]>({
    queryKey: ["shops-list"],
    queryFn: () => api.get<Shop[]>("/shops/?active_only=false"),
    enabled: isAdmin,
  });

  const [selectedShopId, setSelectedShopId] = useState<string | undefined>(undefined);

  const effectiveShopId: string | undefined = isAdmin
    ? selectedShopId ?? shops?.[0]?.id
    : (user?.shopId ?? undefined);

  const effectiveShopName: string = isAdmin
    ? shops?.find((s) => s.id === effectiveShopId)?.name ?? effectiveShopId ?? ""
    : (user?.shopName ?? user?.shopId ?? "");

  const today = todayStr();
  const monthStart = monthStartStr();

  const todayParams = effectiveShopId
    ? `?date_from=${today}&date_to=${today}&shop_id=${effectiveShopId}`
    : `?date_from=${today}&date_to=${today}`;

  const monthParams = effectiveShopId
    ? `?date_from=${monthStart}&date_to=${today}&shop_id=${effectiveShopId}`
    : `?date_from=${monthStart}&date_to=${today}`;

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  // Polling so the dashboard reflects new sales without a manual refresh.
  // refetchOnWindowFocus covers the "tab parked in background, then opened"
  // case; refetchInterval covers an always-open kiosk-style screen.
  const LIVE_OPTS = { refetchInterval: 30_000, refetchOnWindowFocus: true } as const;

  const { data: todaySales, isLoading: loadingToday } = useQuery<SalesReportData>({
    queryKey: ["shop-dashboard", effectiveShopId, "today"],
    queryFn: () => api.get<SalesReportData>(`/reports/sales${todayParams}`),
    enabled: !!effectiveShopId || !isAdmin,
    ...LIVE_OPTS,
  });

  const { data: monthSales, isLoading: loadingMonth } = useQuery<SalesReportData>({
    queryKey: ["shop-dashboard", effectiveShopId, "month"],
    queryFn: () => api.get<SalesReportData>(`/reports/sales${monthParams}`),
    enabled: !!effectiveShopId || !isAdmin,
    ...LIVE_OPTS,
  });

  const { data: paymentData, isLoading: loadingPayment } = useQuery<SalesByPaymentReportData>({
    queryKey: ["shop-dashboard", effectiveShopId, "payment"],
    queryFn: () => api.get<SalesByPaymentReportData>(`/reports/sales-by-payment${todayParams}`),
    enabled: !!effectiveShopId || !isAdmin,
    ...LIVE_OPTS,
  });

  const isLoading = loadingToday || loadingMonth || loadingPayment;

  // ---------------------------------------------------------------------------
  // Render: no shop
  // ---------------------------------------------------------------------------
  if (!isAdmin && !user?.shopId) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t("shopDashboard.noShop", "No shop assigned")}</p>
      </div>
    );
  }

  const grandTotal = paymentData?.grand_total ?? 0;
  // Skip the #1 best-seller and show ranks 2–6 instead. The top item
  // overshadows the rest visually and the manager already knows it; the
  // next tier is what they actually need to act on (re-stock decisions,
  // pricing tweaks).
  const topItems = (todaySales?.rows ?? [])
    .slice()
    .sort((a, b) => b.total - a.total)
    .slice(1, 6);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shop Dashboard</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-muted-foreground text-sm">{effectiveShopName}</span>
            <Badge variant="outline" className="text-xs gap-1">
              <Calendar className="h-3 w-3" />
              {todayLabel()}
            </Badge>
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Shop</span>
            <Select
              value={selectedShopId ?? shops?.[0]?.id ?? ""}
              onValueChange={setSelectedShopId}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Select shop" />
              </SelectTrigger>
              <SelectContent>
                {(shops ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Today Revenue */}
        <Card className="overflow-hidden border border-amber-200/60 shadow-sm bg-white">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-700">Today's Sales</span>
              <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-amber-600" />
              </div>
            </div>
            <p className="text-3xl font-bold tabular-nums text-slate-900">฿{fmt(todaySales?.grand_total)}</p>
            <p className="text-xs text-slate-500 mt-1">{todaySales?.receipt_count ?? 0} receipts</p>
          </div>
        </Card>

        {/* Today Orders */}
        <Card className="overflow-hidden border border-blue-200/60 shadow-sm bg-white">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-700">Today's Orders</span>
              <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center">
                <ShoppingBag className="h-4 w-4 text-blue-600" />
              </div>
            </div>
            <p className="text-3xl font-bold tabular-nums text-slate-900">{todaySales?.receipt_count ?? 0}</p>
            <p className="text-xs text-slate-500 mt-1">transactions</p>
          </div>
        </Card>

        {/* Month Revenue */}
        <Card className="overflow-hidden border border-violet-200/60 shadow-sm bg-white">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-700">This Month's Sales</span>
              <div className="h-9 w-9 rounded-lg bg-violet-100 flex items-center justify-center">
                <Calendar className="h-4 w-4 text-violet-600" />
              </div>
            </div>
            <p className="text-3xl font-bold tabular-nums text-slate-900">฿{fmt(monthSales?.grand_total)}</p>
            <p className="text-xs text-slate-500 mt-1">{monthSales?.receipt_count ?? 0} receipts</p>
          </div>
        </Card>
      </div>

      {/* ── Payment Breakdown ── */}
      <Card className="overflow-hidden shadow-sm border border-slate-200">
        <CardHeader className="bg-slate-50/60 border-b border-slate-200 py-3 px-5">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-800">
            <CreditCard className="h-4 w-4 text-amber-600" />
            Payment Channel Breakdown — Today
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          {(paymentData?.rows ?? []).length === 0 ? (
            <p className="text-center text-muted-foreground py-4 text-sm">No transactions today</p>
          ) : (() => {
            const sorted = [...(paymentData?.rows ?? [])].sort((a, b) => b.total - a.total);
            return (
              <>
                {/* Stacked bar */}
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted gap-px">
                  {sorted.map((row) => {
                    const meta = getMethodMeta(row.payment_method);
                    const pct = grandTotal > 0 ? (row.total / grandTotal) * 100 : 0;
                    return (
                      <div
                        key={row.payment_method}
                        className={cn("h-full transition-all duration-500", meta.bar)}
                        style={{ width: `${pct}%` }}
                        title={`${meta.label}: ${pct.toFixed(1)}%`}
                      />
                    );
                  })}
                </div>

                {/* Compact rows */}
                <div className="divide-y divide-border/50">
                  {sorted.map((row) => {
                    const meta = getMethodMeta(row.payment_method);
                    const pct = grandTotal > 0 ? (row.total / grandTotal) * 100 : 0;
                    return (
                      <div key={row.payment_method} className="flex items-center gap-3 py-2">
                        <div className={cn("flex items-center gap-1.5 w-28 shrink-0 font-medium text-sm", meta.color)}>
                          <span className={cn("h-2.5 w-2.5 rounded-sm shrink-0", meta.bar)} />
                          {meta.icon}
                          {meta.label}
                        </div>
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={cn("h-full rounded-full transition-all duration-500", meta.bar)} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-10 text-right text-xs text-muted-foreground tabular-nums shrink-0">{pct.toFixed(0)}%</span>
                        <span className="w-8 text-right text-xs text-muted-foreground tabular-nums shrink-0">{row.receipt_count}x</span>
                        <span className={cn("w-24 text-right font-bold tabular-nums text-sm shrink-0", meta.color)}>฿{fmt(row.total)}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Total row */}
                <div className="flex items-center justify-between pt-2 border-t px-1">
                  <span className="font-semibold text-sm">Total Today</span>
                  <span className="text-lg font-bold tabular-nums">฿{fmt(grandTotal)}</span>
                </div>
              </>
            );
          })()}
        </CardContent>
      </Card>

      {/* ── Top Items Today ── */}
      {topItems.length > 0 && (
        <Card className="overflow-hidden shadow-sm border border-slate-200">
          <CardHeader className="bg-slate-50/60 border-b border-slate-200 py-3 px-5">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-800">
              <TrendingUp className="h-4 w-4 text-amber-600" />
              Top Selling Items — Today
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-5 py-2.5 font-medium text-muted-foreground">#</th>
                  <th className="text-left px-5 py-2.5 font-medium text-muted-foreground">Item</th>
                  <th className="text-right px-5 py-2.5 font-medium text-muted-foreground">Qty</th>
                  <th className="text-right px-5 py-2.5 font-medium text-muted-foreground">Amount (฿)</th>
                </tr>
              </thead>
              <tbody>
                {topItems.map((item, i) => (
                  <tr key={item.product_name} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-5 py-3 text-muted-foreground">{i + 1}</td>
                    <td className="px-5 py-3 font-medium">{item.product_name}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{item.quantity}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold">
                      {fmt(item.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
