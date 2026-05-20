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
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

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

// ---------------------------------------------------------------------------
// Number formatter
// ---------------------------------------------------------------------------

function fmt(n: number | undefined) {
  return (n ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 });
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

  // Resolve effective shop id
  const effectiveShopId: string | undefined = isAdmin
    ? selectedShopId ?? shops?.[0]?.id
    : (user?.shopId ?? undefined);

  const effectiveShopName: string = isAdmin
    ? shops?.find((s) => s.id === effectiveShopId)?.name ?? effectiveShopId ?? ""
    : (user?.shopName ?? user?.shopId ?? "");

  const today = todayStr();
  const monthStart = monthStartStr();

  // ---------------------------------------------------------------------------
  // Queries — today sales
  // ---------------------------------------------------------------------------
  const todayParams = effectiveShopId
    ? `?date_from=${today}&date_to=${today}&shop_id=${effectiveShopId}`
    : `?date_from=${today}&date_to=${today}`;

  const { data: todaySales, isLoading: loadingToday } = useQuery<SalesReportData>({
    queryKey: ["shop-dashboard", effectiveShopId, "today"],
    queryFn: () => api.get<SalesReportData>(`/reports/sales${todayParams}`),
    enabled: !!effectiveShopId || !isAdmin,
  });

  // ---------------------------------------------------------------------------
  // Queries — this month sales
  // ---------------------------------------------------------------------------
  const monthParams = effectiveShopId
    ? `?date_from=${monthStart}&date_to=${today}&shop_id=${effectiveShopId}`
    : `?date_from=${monthStart}&date_to=${today}`;

  const { data: monthSales, isLoading: loadingMonth } = useQuery<SalesReportData>({
    queryKey: ["shop-dashboard", effectiveShopId, "month"],
    queryFn: () => api.get<SalesReportData>(`/reports/sales${monthParams}`),
    enabled: !!effectiveShopId || !isAdmin,
  });

  // ---------------------------------------------------------------------------
  // Queries — payment breakdown (today)
  // ---------------------------------------------------------------------------
  const { data: paymentData, isLoading: loadingPayment } = useQuery<SalesByPaymentReportData>({
    queryKey: ["shop-dashboard", effectiveShopId, "payment"],
    queryFn: () =>
      api.get<SalesByPaymentReportData>(`/reports/sales-by-payment${todayParams}`),
    enabled: !!effectiveShopId || !isAdmin,
  });

  const isLoading = loadingToday || loadingMonth || loadingPayment;

  // ---------------------------------------------------------------------------
  // Render: no shop assigned for manager
  // ---------------------------------------------------------------------------
  if (!isAdmin && !user?.shopId) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">
          {t("shopDashboard.noShop", "ไม่พบร้านค้า")}
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {t("shopDashboard.title", "Dashboard ร้านค้า")}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">{effectiveShopName}</p>
        </div>

        {/* Admin shop selector */}
        {isAdmin && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {t("shopDashboard.selectShop", "เลือกร้านค้า")}
            </span>
            <Select
              value={selectedShopId ?? shops?.[0]?.id ?? ""}
              onValueChange={setSelectedShopId}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder={t("shopDashboard.selectShop", "เลือกร้านค้า")} />
              </SelectTrigger>
              <SelectContent>
                {(shops ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("shopDashboard.loading", "กำลังโหลด…")}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Today Revenue */}
        <Card className="overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-amber-500 to-orange-500 text-white py-3 px-4">
            <CardTitle className="text-sm font-semibold">
              {t("shopDashboard.todayRevenue", "ยอดขายวันนี้")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">
              ฿{fmt(todaySales?.grand_total)}
            </p>
          </CardContent>
        </Card>

        {/* Today Orders */}
        <Card className="overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-amber-500 to-orange-500 text-white py-3 px-4">
            <CardTitle className="text-sm font-semibold">
              {t("shopDashboard.todayOrders", "คำสั่งซื้อวันนี้")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">
              {(todaySales?.receipt_count ?? 0).toLocaleString("th-TH")}
            </p>
          </CardContent>
        </Card>

        {/* This Month Revenue */}
        <Card className="overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-amber-500 to-orange-500 text-white py-3 px-4">
            <CardTitle className="text-sm font-semibold">
              {t("shopDashboard.monthRevenue", "ยอดขายเดือนนี้")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">
              ฿{fmt(monthSales?.grand_total)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Payment Breakdown */}
      <Card>
        <CardHeader className="bg-gradient-to-r from-amber-500 to-orange-500 text-white py-3 px-4 rounded-t-lg">
          <CardTitle className="text-sm font-semibold">
            {t("shopDashboard.paymentBreakdown", "สรุปช่องทางชำระ")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-2 font-medium">
                  {t("shopDashboard.colPaymentMethod", "ช่องทาง")}
                </th>
                <th className="text-right px-4 py-2 font-medium">
                  {t("shopDashboard.colCount", "จำนวน")}
                </th>
                <th className="text-right px-4 py-2 font-medium">
                  {t("shopDashboard.colAmount", "ยอด (฿)")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(paymentData?.rows ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-4 text-center text-muted-foreground">
                    —
                  </td>
                </tr>
              ) : (
                (paymentData?.rows ?? []).map((row) => (
                  <tr key={row.payment_method} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2 capitalize">{row.payment_method}</td>
                    <td className="px-4 py-2 text-right">
                      {row.receipt_count.toLocaleString("th-TH")}
                    </td>
                    <td className="px-4 py-2 text-right">{fmt(row.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
