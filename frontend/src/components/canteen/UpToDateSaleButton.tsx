// Self-contained "Up-to-date Sale" (formerly Close Day) button.
// Renders a button that triggers POST /canteen/{shopId}/close-day, then shows
// the resulting summary in a dialog with CSV export + print slip actions.
//
// Used in two places:
//   - Canteen POS header (so cashiers can run EOD without leaving the till)
//   - Canteen Management shop detail
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarCheck, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { toast } from "@/components/ui/sonner";
import { api, ApiError } from "@/lib/api";

export interface CloseDaySummary {
  shop_id: string;
  date: string;
  total_orders: number;
  total_revenue: number;
  item_count: number;
  payment_breakdown: Record<string, number | undefined>;
}

interface Props {
  shopId: string;
  shopName?: string | null;
  /** Compact mode — small icon-only on narrow screens. Default false. */
  size?: "sm" | "default";
  className?: string;
}

export function UpToDateSaleButton({ shopId, shopName, size = "sm", className }: Props) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<CloseDaySummary | null>(null);
  const [open, setOpen] = useState(false);

  const closeDayMut = useMutation({
    mutationFn: () => api.post<CloseDaySummary>(`/canteen/${shopId}/close-day`),
    onSuccess: (data) => {
      setSummary(data);
      setOpen(true);
    },
    onError: (e) => {
      toast.error(
        e instanceof ApiError ? e.detail : t("canteen.closeDayFailed", "Up-to-date Sale failed"),
      );
    },
  });

  function exportCsv(s: CloseDaySummary) {
    const rows = [
      ["Date", s.date],
      ["Total Orders", String(s.total_orders)],
      ["Total Revenue (THB)", s.total_revenue.toFixed(2)],
      ["Items Sold", String(s.item_count)],
      [""],
      ["Payment Method", "Amount (THB)"],
      ...Object.entries(s.payment_breakdown).map(([method, amount]) => [
        method.charAt(0).toUpperCase() + method.slice(1),
        (amount ?? 0).toFixed(2),
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `close-day-${s.shop_id}-${s.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printSlip(s: CloseDaySummary) {
    const paymentRows = Object.entries(s.payment_breakdown)
      .map(([method, amount]) => {
        const label = t(`canteen.paymentMethod_${method}`, { defaultValue: method });
        return `<tr><td style="padding:4px 8px">${label}</td><td style="padding:4px 8px;text-align:right">฿${(amount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td></tr>`;
      })
      .join("");

    const html = `
      <html><head><title>Close Day Slip — ${s.date}</title>
      <style>body{font-family:monospace;max-width:320px;margin:0 auto;padding:16px}
      h2{text-align:center;font-size:1rem;margin-bottom:4px}
      p{text-align:center;color:#666;font-size:.8rem;margin:0 0 12px}
      table{width:100%;border-collapse:collapse}
      td{font-size:.85rem}
      hr{border:none;border-top:1px dashed #999;margin:8px 0}
      .total{font-weight:bold}</style></head>
      <body>
        <h2>${shopName ?? s.shop_id}</h2>
        <p>${t("canteen.closeDayConfirm", { date: s.date })}</p>
        <hr/>
        <table>
          <tr><td style="padding:4px 8px">${t("canteen.totalOrders")}</td><td style="padding:4px 8px;text-align:right">${s.total_orders}</td></tr>
          <tr><td style="padding:4px 8px">${t("canteen.itemCount")}</td><td style="padding:4px 8px;text-align:right">${s.item_count}</td></tr>
        </table>
        <hr/>
        <p style="text-align:left;padding:0 8px;font-weight:bold;margin:4px 0">${t("canteen.paymentBreakdown")}</p>
        <table>${paymentRows}</table>
        <hr/>
        <table><tr class="total"><td style="padding:4px 8px">${t("canteen.totalRevenue")}</td><td style="padding:4px 8px;text-align:right">฿${s.total_revenue.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td></tr></table>
      </body></html>`;

    const win = window.open("", "_blank", "width=400,height=600");
    if (!win) {
      toast.error(t("returns.popupBlocked", "Cannot open print window — please allow pop-ups"));
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  }

  return (
    <>
      <Button
        variant="outline"
        size={size}
        onClick={() => closeDayMut.mutate()}
        disabled={closeDayMut.isPending || !shopId}
        className={className}
      >
        <CalendarCheck className="h-4 w-4 mr-1.5" />
        {closeDayMut.isPending
          ? t("canteen.closeDayLoading", "Closing day…")
          : t("canteen.upToDateSale", "Up-to-date Sale")}
      </Button>

      {summary && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {t("canteen.closeDayConfirm", { date: summary.date })}
              </DialogTitle>
              <DialogDescription>{t("canteen.closeDayDescription")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <Card>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("canteen.totalOrders")}</span>
                    <span className="font-medium">{summary.total_orders}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("canteen.itemCount")}</span>
                    <span className="font-medium">{summary.item_count}</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold">
                    <span>{t("canteen.totalRevenue")}</span>
                    <span>
                      ฿{summary.total_revenue.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </span>
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
                    {Object.entries(summary.payment_breakdown).map(([method, amount]) => (
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
                <Button variant="outline" className="flex-1" onClick={() => exportCsv(summary)}>
                  <Download className="h-4 w-4 mr-1.5" />
                  {t("canteen.exportCsv")}
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => printSlip(summary)}>
                  <Printer className="h-4 w-4 mr-1.5" />
                  {t("canteen.printSlip")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
