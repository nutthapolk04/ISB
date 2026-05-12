import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText, FileDown, ArrowLeftRight, Loader2, Package, TrendingUp, CreditCard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { InfoCallout } from "@/components/InfoCallout";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface SalesRow { product_name: string; quantity: number; total: number; }
interface SalesReportData { rows: SalesRow[]; grand_total: number; receipt_count: number; }

interface StockRow { product_code: string | null; product_name: string; stock_qty: number; shop_id: string; shop_name: string | null; }
interface StockReportData { rows: StockRow[]; }

interface ReturnRow {
  id: number; return_date: string; receipt_number: string;
  product_name: string; quantity: number;
  refund_amount: number; exchange_amount: number; status: string;
}
interface ReturnReportData { rows: ReturnRow[]; total_refund: number; total_exchange: number; }

interface SalesByPaymentRow { payment_method: string; receipt_count: number; total: number; }
interface SalesByPaymentReportData { rows: SalesByPaymentRow[]; grand_total: number; total_receipts: number; }

const REPORT_DEFS: { type: string; icon: typeof FileText; needsRange: boolean }[] = [
  { type: "salesReport",         icon: FileText,       needsRange: true },
  { type: "topSellingReport",    icon: TrendingUp,     needsRange: true },
  { type: "salesByPaymentReport", icon: CreditCard,    needsRange: true },
  { type: "stockReport",         icon: Package,        needsRange: false },
  { type: "returnReport",        icon: ArrowLeftRight, needsRange: true },
];

const BOM = String.fromCharCode(0xfeff);

function downloadCsv(name: string, content: string) {
  const blob = new Blob([BOM + content], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", name);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const csvEscape = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes("\n") || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

const Reports = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [selectedReportType, setSelectedReportType] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [exporting, setExporting] = useState(false);

  const currentDef = REPORT_DEFS.find((d) => d.type === selectedReportType);
  const needsRange = currentDef?.needsRange ?? true;

  const handleReportClick = (reportType: string) => {
    setSelectedReportType(reportType);
    setStartDate("");
    setEndDate("");
    setIsDatePickerOpen(true);
  };

  const shopParam = user?.shopId && user?.role !== "admin"
    ? `&shop_id=${encodeURIComponent(user.shopId)}`
    : "";

  const handleExportExcel = async () => {
    if (needsRange && (!startDate || !endDate)) {
      toast.error(t("reports.selectDateRangeDesc"));
      return;
    }

    const reportName = t(`reports.${selectedReportType}`);
    setExporting(true);
    try {
      let csv = `${reportName}\n`;
      if (needsRange) {
        csv += `${t("reports.startDate")}: ${startDate}\n${t("reports.endDate")}: ${endDate}\n\n`;
      } else {
        csv += `\n`;
      }

      if (selectedReportType === "salesReport" || selectedReportType === "topSellingReport") {
        const data = await api.get<SalesReportData>(
          `/reports/sales?date_from=${startDate}&date_to=${endDate}${shopParam}`,
        );
        const rows = selectedReportType === "topSellingReport"
          ? [...data.rows].sort((a, b) => b.quantity - a.quantity)
          : data.rows;
        csv += `${t("reports.colProduct")},${t("reports.colQuantity")},${t("reports.colTotal")}\n`;
        for (const r of rows) {
          csv += `${csvEscape(r.product_name)},${r.quantity},${r.total.toFixed(2)}\n`;
        }
        csv += `\n${t("reports.grandTotal")},,${data.grand_total.toFixed(2)}\n`;
        csv += `${t("reports.receiptCount")},${data.receipt_count},\n`;
      } else if (selectedReportType === "salesByPaymentReport") {
        const data = await api.get<SalesByPaymentReportData>(
          `/reports/sales-by-payment?date_from=${startDate}&date_to=${endDate}${shopParam}`,
        );
        csv += `${t("reports.colPaymentMethod") || "Payment Method"},${t("reports.colReceiptCount") || "Receipt Count"},${t("reports.colTotal")}\n`;
        for (const r of data.rows) {
          const methodLabel = t(`payment.${r.payment_method}`) || r.payment_method;
          csv += `${csvEscape(methodLabel)},${r.receipt_count},${r.total.toFixed(2)}\n`;
        }
        csv += `\n${t("reports.grandTotal")},,${data.grand_total.toFixed(2)}\n`;
        csv += `${t("reports.totalReceipts") || "Total Receipts"},${data.total_receipts},\n`;
      } else if (selectedReportType === "stockReport") {
        const stockShopParam = shopParam.replace(/^&/, "?");
        const data = await api.get<StockReportData>(`/reports/stock${stockShopParam}`);
        csv += `${t("reports.colShop")},${t("reports.colProductCode")},${t("reports.colProduct")},${t("reports.colStock")}\n`;
        for (const r of data.rows) {
          csv += `${csvEscape(r.shop_name ?? r.shop_id)},${csvEscape(r.product_code)},${csvEscape(r.product_name)},${r.stock_qty}\n`;
        }
      } else if (selectedReportType === "returnReport") {
        const data = await api.get<ReturnReportData>(
          `/reports/returns?date_from=${startDate}&date_to=${endDate}${shopParam}`,
        );
        csv += `${t("reports.colId")},${t("reports.colDate")},${t("reports.colReceipt")},${t("reports.colProduct")},${t("reports.colQuantity")},${t("reports.colRefund")},${t("reports.colExchange")},${t("reports.colStatus")}\n`;
        for (const r of data.rows) {
          csv += `${r.id},${r.return_date.slice(0, 10)},${csvEscape(r.receipt_number)},${csvEscape(r.product_name)},${r.quantity},${r.refund_amount.toFixed(2)},${r.exchange_amount.toFixed(2)},${csvEscape(r.status)}\n`;
        }
        csv += `\n${t("reports.totalRefund")},,,,,${data.total_refund.toFixed(2)},,\n`;
        csv += `${t("reports.totalExchange")},,,,,,${data.total_exchange.toFixed(2)},\n`;
      } else {
        toast.message(t("reports.comingSoon"));
        setExporting(false);
        return;
      }

      const dateLabel = needsRange ? `_${startDate}_${endDate}` : "";
      downloadCsv(`${reportName}${dateLabel}.csv`, csv);
      toast.success(t("reports.exportSuccess"));
      setIsDatePickerOpen(false);
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric");
      toast.error(detail);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title mb-2">{t("reports.title")}</h1>
        <p className="page-description">{t("reports.description")}</p>
      </div>

      <InfoCallout
        id="reports.exportFormat"
        variant="info"
        title={t("reports.info.exportFormat.title")}
      >
        {t("reports.info.exportFormat.body")}
      </InfoCallout>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {REPORT_DEFS.map(({ type, icon: Icon }) => (
          <Card
            key={type}
            className="interactive-card"
            onClick={() => handleReportClick(type)}
          >
            <CardHeader>
              <CardTitle className="flex items-center">
                <Icon className="h-5 w-5 mr-2 text-primary" />
                {t(`reports.${type}`)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t(`reports.${type}Desc`)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Date Picker Dialog for Excel Export */}
      <Dialog open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileDown className="h-6 w-6 text-primary" />
              {needsRange ? t("reports.selectDateRange") : t("reports.exportExcel")}
            </DialogTitle>
            <DialogDescription>
              {needsRange ? t("reports.selectDateRangeDesc") : t("reports.stockReportDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {needsRange && (
              <div className="space-y-2">
                <Label htmlFor="dateRange">
                  {t("reports.startDate")} — {t("reports.endDate")}
                </Label>
                <DateRangePicker
                  id="dateRange"
                  startDate={startDate}
                  endDate={endDate}
                  onStartChange={setStartDate}
                  onEndChange={setEndDate}
                />
              </div>
            )}

            <div className="bg-secondary p-3 rounded-lg">
              <p className="text-sm font-medium">
                {selectedReportType && t(`reports.${selectedReportType}`)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedReportType && t(`reports.${selectedReportType}Desc`)}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDatePickerOpen(false)} disabled={exporting}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleExportExcel} disabled={exporting}>
              {exporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4 mr-2" />
              )}
              {t("reports.exportExcel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Reports;
