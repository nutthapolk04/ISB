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
import { CalendarCheck, Printer } from "lucide-react";
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
import { type SchoolInfo } from "@/contexts/SchoolInfoContext";

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
  schoolInfo?: SchoolInfo | null;
  /** Compact mode — small icon-only on narrow screens. Default false. */
  size?: "sm" | "default";
  className?: string;
}

export function UpToDateSaleButton({ shopId, shopName, schoolInfo, size = "sm", className }: Props) {
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

  function printSlip(s: CloseDaySummary) {
    const paymentRows = Object.entries(s.payment_breakdown)
      .map(([method, amount]) => {
        const label = t(`canteen.paymentMethod_${method.toLowerCase()}`, { defaultValue: method });
        return `<tr><td style="padding:4px 8px">${label}</td><td style="padding:4px 8px;text-align:right">฿${(amount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td></tr>`;
      })
      .join("");

    const logoHtml = schoolInfo?.logoUrl
      ? `<img src="${schoolInfo.logoUrl}" width="56" height="56" style="object-fit:contain;display:block;margin:0 auto 4px" />`
      : "";
    const schoolName = schoolInfo?.name ?? "International School Bangkok";
    const schoolAddr = schoolInfo?.address ? `<p style="margin:0;font-size:.75rem;color:#555">${schoolInfo.address}</p>` : "";
    const schoolTax  = schoolInfo?.taxId   ? `<p style="margin:0;font-size:.75rem;color:#555">Tax ID: ${schoolInfo.taxId}</p>` : "";
    const schoolTel  = schoolInfo?.phone   ? `<p style="margin:0;font-size:.75rem;color:#555">Tel: ${schoolInfo.phone}</p>` : "";

    // Shop name on the slip — auditors asked for an explicit "which shop
    // closed?" line so a stack of slips can be sorted without guessing.
    const shopLine = shopName
      ? `<p style="margin:2px 0 0;font-size:.85rem;color:#111;font-weight:600">${shopName}</p>`
      : `<p style="margin:2px 0 0;font-size:.75rem;color:#555">Shop: ${s.shop_id}</p>`;

    // Set the window title to "Up-to-date Sale — DATE" (not "Close Day
    // Slip"), and zero out @page margins so Chrome stops printing the
    // browser-injected header (date | title) in the corners.
    const html = `
      <html><head><title>${t("canteen.upToDateSale", "Up-to-date Sale")} — ${s.date}</title>
      <style>
      @page { margin: 0; size: auto; }
      body{font-family:monospace;max-width:320px;margin:0 auto;padding:16px}
      h2{text-align:center;font-size:1rem;margin-bottom:2px}
      p{text-align:center;color:#666;font-size:.8rem;margin:0 0 4px}
      table{width:100%;border-collapse:collapse}
      td{font-size:.85rem}
      hr{border:none;border-top:1px dashed #999;margin:8px 0}
      .total{font-weight:bold}</style></head>
      <body>
        ${logoHtml}
        <h2>${schoolName}</h2>
        ${shopLine}
        ${schoolAddr}${schoolTax}${schoolTel}
        <p style="margin-top:6px">${t("canteen.upToDateSale", "Up-to-date Sale")} — ${s.date}</p>
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
                          {t(`canteen.paymentMethod_${method.toLowerCase()}`, { defaultValue: method })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(amount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex">
                <Button className="w-full" onClick={() => printSlip(summary)}>
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
