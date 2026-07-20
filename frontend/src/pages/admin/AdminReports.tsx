import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useSchoolInfo } from "@/contexts/SchoolInfoContext";
import {
  exportToPDF,
  exportToExcel,
  buildDateFilterLine,
  type ReportPayload,
} from "@/lib/reportExport";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Label } from "@/components/ui/label";
import { InfoCallout } from "@/components/InfoCallout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { FileSpreadsheet, FileText, Loader2, Wallet, Receipt } from "lucide-react";

type ReportKind = "topup" | "transaction";
type TopupChannel = "all" | "kiosk" | "online" | "cashier";

interface TopupRow {
  id: number;
  created_at: string;
  channel: "kiosk" | "online" | "cashier";
  topped_by: string;
  recipient_name: string;
  recipient_code: string;
  amount: number;
  cashier_name: string | null;
  payment_method: string | null;
}

interface TransactionRow {
  id: number;
  created_at: string;
  payer_id: string;
  payer_name: string;
  payment_method: string;
  shop_name: string;
  amount: number;
  cashier_name: string;
  receipt_number: string;
  status: string;
}

const CHANNEL_LABEL: Record<string, string> = {
  kiosk: "Kiosk",
  online: "Online (Parent)",
  cashier: "Cashier (Store)",
};

export default function AdminReports() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const school = useSchoolInfo();

  const [selected, setSelected] = useState<ReportKind | "">("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [channel, setChannel] = useState<TopupChannel>("all");
  const [exporting, setExporting] = useState(false);

  const openReport = (kind: ReportKind) => {
    setSelected(kind);
    setStartDate("");
    setEndDate("");
    setChannel("all");
    setDialogOpen(true);
  };

  const buildPayload = async (): Promise<{
    payload: ReportPayload<Record<string, unknown>>;
    baseFilename: string;
  } | null> => {
    if (!startDate || !endDate) {
      toast.error(t("reports.selectDateRangeDesc"));
      return null;
    }
    const dateFilter = buildDateFilterLine("Date", startDate, endDate);
    const filters = dateFilter ? [dateFilter] : [];
    const dateLabel = `_${startDate}_${endDate}`;

    if (selected === "topup") {
      const params = new URLSearchParams({
        date_from: startDate,
        date_to: endDate,
      });
      if (channel !== "all") params.set("channel", channel);
      const data = await api.get<{ items: TopupRow[]; amount_total: number }>(
        `/wallets/admin/topup-report?${params.toString()}`,
      );
      if (channel !== "all") filters.push(`Type: ${CHANNEL_LABEL[channel]}`);

      return {
        payload: {
          meta: {
            title: t("adminReports.topupReport"),
            schoolName: school.name,
            schoolLogoUrl: school.logoUrl || undefined,
            reportId: "ISB-ADM-TOPUP",
            filters,
            runByName: user?.fullName ?? user?.username,
          },
          columns: [
            { header: t("adminReports.colDateTime"), key: "created_at", format: "datetime", width: 20 },
            { header: t("adminReports.colChannel"), key: "channel_label", width: 16 },
            { header: t("adminReports.colToppedBy"), key: "topped_by", width: 24 },
            { header: t("adminReports.colRecipient"), key: "recipient_name", width: 24 },
            { header: t("adminReports.colAmount"), key: "amount", format: "currency", align: "right", width: 14 },
            { header: t("adminReports.colCashier"), key: "cashier_name", width: 20 },
          ],
          rows: data.items.map((r) => ({
            ...r,
            channel_label: CHANNEL_LABEL[r.channel] ?? r.channel,
            cashier_name: r.cashier_name ?? "",
          })) as unknown as Record<string, unknown>[],
          totals: { amount: data.amount_total },
        },
        baseFilename: `TopupReport${dateLabel}`,
      };
    }

    if (selected === "transaction") {
      const params = new URLSearchParams({
        date_from: startDate,
        date_to: endDate,
      });
      const data = await api.get<{ items: TransactionRow[]; amount_total: number }>(
        `/wallets/admin/transaction-report?${params.toString()}`,
      );

      return {
        payload: {
          meta: {
            title: t("adminReports.transactionReport"),
            schoolName: school.name,
            schoolLogoUrl: school.logoUrl || undefined,
            reportId: "ISB-ADM-TXN",
            filters,
            runByName: user?.fullName ?? user?.username,
          },
          columns: [
            { header: t("adminReports.colDateTime"), key: "created_at", format: "datetime", width: 20 },
            { header: t("adminReports.colPayerId"), key: "payer_id", width: 14 },
            { header: t("adminReports.colPayerName"), key: "payer_name", width: 24 },
            { header: t("adminReports.colPaymentMethod"), key: "payment_method", width: 14 },
            { header: t("adminReports.colShop"), key: "shop_name", width: 20 },
            { header: t("adminReports.colAmount"), key: "amount", format: "currency", align: "right", width: 14 },
            { header: t("adminReports.colCashier"), key: "cashier_name", width: 20 },
            { header: t("adminReports.colStatus"), key: "status", width: 10 },
          ],
          rows: data.items as unknown as Record<string, unknown>[],
          totals: { amount: data.amount_total },
        },
        baseFilename: `TransactionReport${dateLabel}`,
      };
    }

    return null;
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const result = await buildPayload();
      if (!result) return;
      exportToExcel(result.payload, `${result.baseFilename}.xlsx`);
      toast.success(t("reports.exportSuccess"));
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric"));
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const result = await buildPayload();
      if (!result) return;
      await exportToPDF(result.payload, `${result.baseFilename}.pdf`);
      toast.success(t("reports.exportSuccess"));
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric"));
    } finally {
      setExporting(false);
    }
  };

  const cards = [
    {
      kind: "topup" as const,
      icon: Wallet,
      title: t("adminReports.topupReport"),
      desc: t("adminReports.topupReportDesc"),
    },
    {
      kind: "transaction" as const,
      icon: Receipt,
      title: t("adminReports.transactionReport"),
      desc: t("adminReports.transactionReportDesc"),
    },
  ];

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title mb-2">{t("adminReports.title")}</h1>
        <p className="page-description">{t("adminReports.description")}</p>
      </div>

      <InfoCallout
        id="adminReports.info"
        variant="info"
        title={t("adminReports.infoTitle")}
      >
        {t("adminReports.infoBody")}
      </InfoCallout>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {cards.map(({ kind, icon: Icon, title, desc }) => (
          <Card key={kind} className="interactive-card" onClick={() => openReport(kind)}>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Icon className="h-5 w-5 mr-2 text-primary" />
                {title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selected === "topup"
                ? t("adminReports.topupReport")
                : t("adminReports.transactionReport")}
            </DialogTitle>
            <DialogDescription>{t("reports.selectDateRangeDesc")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>
                {t("reports.startDate")} — {t("reports.endDate")}
              </Label>
              <DateRangePicker
                startDate={startDate}
                endDate={endDate}
                onStartChange={setStartDate}
                onEndChange={setEndDate}
              />
            </div>

            {selected === "topup" && (
              <div className="space-y-2">
                <Label>{t("adminReports.channelFilter")}</Label>
                <Select value={channel} onValueChange={(v) => setChannel(v as TopupChannel)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("adminReports.channelAll")}</SelectItem>
                    <SelectItem value="kiosk">{t("adminReports.channelKiosk")}</SelectItem>
                    <SelectItem value="online">{t("adminReports.channelOnline")}</SelectItem>
                    <SelectItem value="cashier">{t("adminReports.channelCashier")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={exporting}>
              {t("common.cancel")}
            </Button>
            <Button variant="outline" onClick={handleExportPdf} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
              {t("reports.exportPdf")}
            </Button>
            <Button onClick={handleExportExcel} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
              {t("reports.exportExcel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
