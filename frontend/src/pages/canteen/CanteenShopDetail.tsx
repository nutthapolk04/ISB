import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowUpRight, UtensilsCrossed, Users, CalendarCheck, Download, Printer } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import CanteenProducts from "./CanteenProducts";
import CanteenCategories from "./CanteenCategories";
import { PricePanelManager } from "@/components/PricePanelManager";
import { ShopImportPanel } from "@/components/ShopImportPanel";

interface Shop {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
  module: string;
}

interface CloseDaySummary {
  shop_id: string;
  date: string;
  total_orders: number;
  total_revenue: number;
  item_count: number;
  payment_breakdown: {
    wallet?: number;
    cash?: number;
    card?: number;
    [key: string]: number | undefined;
  };
}

export default function CanteenShopDetail() {
  const { shopId } = useParams<{ shopId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { hasRole } = useAuth();

  const [closeDaySummary, setCloseDaySummary] = useState<CloseDaySummary | null>(null);
  const [closeDayOpen, setCloseDayOpen] = useState(false);

  const { data: shop, isLoading } = useQuery({
    queryKey: ["shop", shopId],
    queryFn: () => api.get<Shop>(`/shops/${shopId}`),
    enabled: !!shopId,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (shop) {
      setName(shop.name);
      setDescription(shop.description ?? "");
      setIsActive(shop.is_active);
    }
  }, [shop]);

  const closeDayMut = useMutation({
    mutationFn: () =>
      api.post<CloseDaySummary>(`/canteen/${shopId}/close-day`),
    onSuccess: (data) => {
      setCloseDaySummary(data);
      setCloseDayOpen(true);
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.detail : t("canteen.closeDayFailed"));
    },
  });

  function exportCsv(summary: CloseDaySummary) {
    const rows = [
      ["Date", summary.date],
      ["Total Orders", String(summary.total_orders)],
      ["Total Revenue (THB)", summary.total_revenue.toFixed(2)],
      ["Items Sold", String(summary.item_count)],
      [""],
      ["Payment Method", "Amount (THB)"],
      ...Object.entries(summary.payment_breakdown).map(([method, amount]) => [
        method.charAt(0).toUpperCase() + method.slice(1),
        (amount ?? 0).toFixed(2),
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `close-day-${summary.shop_id}-${summary.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printSlip(summary: CloseDaySummary) {
    const paymentRows = Object.entries(summary.payment_breakdown)
      .map(([method, amount]) => {
        const label = t(`canteen.paymentMethod_${method}`, { defaultValue: method });
        return `<tr><td style="padding:4px 8px">${label}</td><td style="padding:4px 8px;text-align:right">฿${(amount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td></tr>`;
      })
      .join("");

    const html = `
      <html><head><title>Close Day Slip — ${summary.date}</title>
      <style>body{font-family:monospace;max-width:320px;margin:0 auto;padding:16px}
      h2{text-align:center;font-size:1rem;margin-bottom:4px}
      p{text-align:center;color:#666;font-size:.8rem;margin:0 0 12px}
      table{width:100%;border-collapse:collapse}
      td{font-size:.85rem}
      hr{border:none;border-top:1px dashed #999;margin:8px 0}
      .total{font-weight:bold}</style></head>
      <body>
        <h2>${shop?.name ?? summary.shop_id}</h2>
        <p>${t("canteen.closeDayConfirm", { date: summary.date })}</p>
        <hr/>
        <table>
          <tr><td style="padding:4px 8px">${t("canteen.totalOrders")}</td><td style="padding:4px 8px;text-align:right">${summary.total_orders}</td></tr>
          <tr><td style="padding:4px 8px">${t("canteen.itemCount")}</td><td style="padding:4px 8px;text-align:right">${summary.item_count}</td></tr>
        </table>
        <hr/>
        <p style="text-align:left;padding:0 8px;font-weight:bold;margin:4px 0">${t("canteen.paymentBreakdown")}</p>
        <table>${paymentRows}</table>
        <hr/>
        <table><tr class="total"><td style="padding:4px 8px">${t("canteen.totalRevenue")}</td><td style="padding:4px 8px;text-align:right">฿${summary.total_revenue.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td></tr></table>
      </body></html>`;

    const win = window.open("", "_blank", "width=400,height=600");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  }

  const saveMut = useMutation({
    mutationFn: () =>
      api.patch(`/shops/${shopId}`, {
        name: name.trim(),
        description: description.trim() || null,
        is_active: isActive,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shop", shopId] });
      qc.invalidateQueries({ queryKey: ["shops"] });
      toast.success(t("canteen.shopUpdated"));
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.detail : t("canteen.shopUpdateFailed"));
    },
  });

  if (isLoading) {
    return (
      <div className="page-shell">
        <p className="text-muted-foreground">{t("canteen.loading")}</p>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header flex flex-wrap items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/canteen/management")}
          className="-ml-2 shrink-0"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t("canteen.backToManagement")}
        </Button>
        <div>
          <h1 className="page-title flex items-center gap-2">
            <UtensilsCrossed className="h-6 w-6 text-amber-500" />
            {shop?.name ?? shopId}
          </h1>
          <p className="page-description">{t("canteen.canteenLabel")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {hasRole("cashier", "manager", "admin") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => closeDayMut.mutate()}
              disabled={closeDayMut.isPending}
            >
              <CalendarCheck className="h-4 w-4 mr-1.5" />
              {closeDayMut.isPending ? t("canteen.closeDayLoading") : t("canteen.upToDateSale")}
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to={`/users?shop=${shopId}`}>
              <Users className="h-4 w-4 mr-1.5" />
              {t("shopUsers.manageStaffLink")}
              <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="menu">
        <TabsList>
          <TabsTrigger value="menu">{t("canteen.tabMenu")}</TabsTrigger>
          <TabsTrigger value="categories">{t("canteen.tabCategories")}</TabsTrigger>
          <TabsTrigger value="panels">{t("canteen.tabPanels", "Price Panels")}</TabsTrigger>
          <TabsTrigger value="info">{t("canteen.tabInfo")}</TabsTrigger>
        </TabsList>

        <TabsContent value="menu" className="mt-4 space-y-4">
          {(hasRole("admin") || hasRole("manager")) && <ShopImportPanel shopId={shopId} />}
          <CanteenProducts shopId={shopId} embedded />
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          {shopId && <CanteenCategories shopId={shopId} />}
        </TabsContent>

        <TabsContent value="panels" className="mt-4">
          {shopId && <PricePanelManager shopId={shopId} autoLoad />}
        </TabsContent>

        <TabsContent value="info" className="mt-4">
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>{t("canteen.tabInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t("management.shopId", "Shop ID")}</Label>
                <div className="rounded-md border bg-muted px-3 py-2 text-sm font-mono text-muted-foreground">
                  {shopId}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t("canteen.shopName")}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("canteen.shopDescription")}</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("canteen.descriptionPlaceholder")}
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={isActive} onCheckedChange={setIsActive} />
                <Label>{isActive ? t("canteen.statusActive") : t("canteen.statusInactive")}</Label>
              </div>
              <Button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
                className="bg-amber-500 hover:bg-amber-600"
              >
                {saveMut.isPending ? t("canteen.saving") : t("canteen.save")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {closeDaySummary && (
        <Dialog open={closeDayOpen} onOpenChange={setCloseDayOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {t("canteen.closeDayConfirm", { date: closeDaySummary.date })}
              </DialogTitle>
              <DialogDescription>{t("canteen.closeDayDescription")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <Card>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("canteen.totalOrders")}</span>
                    <span className="font-medium">{closeDaySummary.total_orders}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("canteen.itemCount")}</span>
                    <span className="font-medium">{closeDaySummary.item_count}</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold">
                    <span>{t("canteen.totalRevenue")}</span>
                    <span>฿{closeDaySummary.total_revenue.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                  </div>
                </CardContent>
              </Card>

              <div>
                <p className="text-sm font-medium mb-2">{t("canteen.paymentBreakdown")}</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("canteen.paymentMethod")}</TableHead>
                      <TableHead className="text-right">฿</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(closeDaySummary.payment_breakdown).map(([method, amount]) => (
                      <TableRow key={method}>
                        <TableCell>
                          {t(`canteen.paymentMethod_${method}`, { defaultValue: method })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(amount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => exportCsv(closeDaySummary)}
                >
                  <Download className="h-4 w-4 mr-1.5" />
                  {t("canteen.exportCsv")}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => printSlip(closeDaySummary)}
                >
                  <Printer className="h-4 w-4 mr-1.5" />
                  {t("canteen.printSlip")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
