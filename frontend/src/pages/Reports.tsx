import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, FileDown, ArrowLeftRight, Loader2, Package, TrendingUp, CreditCard, ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoCallout } from "@/components/InfoCallout";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface CanteenShop { id: string; name: string; }

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
interface SalesByPaymentReportData {
  rows: SalesByPaymentRow[];
  grand_total: number;
  total_receipts: number;
  retail_total: number;
  department_total: number;
  department_receipts: number;
}

interface StockCardRow {
  date: string;
  movement_type: string;
  quantity: number;
  reference: string | null;
  notes: string | null;
  running_balance: number;
}
interface StockCardReportData {
  product_variant_id: number;
  product_name: string;
  sku: string;
  date_from: string;
  date_to: string;
  opening_balance: number;
  rows: StockCardRow[];
  closing_balance: number;
}

const REPORT_DEFS: { type: string; icon: typeof FileText; needsRange: boolean }[] = [
  { type: "salesReport",         icon: FileText,        needsRange: true },
  { type: "topSellingReport",    icon: TrendingUp,      needsRange: true },
  { type: "salesByPaymentReport", icon: CreditCard,     needsRange: true },
  { type: "stockReport",         icon: Package,         needsRange: false },
  { type: "returnReport",        icon: ArrowLeftRight,  needsRange: true },
  { type: "stockCardReport",     icon: ClipboardList,   needsRange: true },
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

  // Canteen area manager: null shopId but shopModule=canteen → show stall selector
  const isCanteenAreaMgr = user?.shopModule === "canteen" && !user?.shopId && user?.role !== "admin";
  const [canteenStalls, setCanteenStalls] = useState<CanteenShop[]>([]);
  const [selectedStall, setSelectedStall] = useState<string>("all");

  useEffect(() => {
    if (!isCanteenAreaMgr) return;
    api.get<CanteenShop[]>("/shops?module=canteen").then(setCanteenStalls).catch(() => {});
  }, [isCanteenAreaMgr]);

  // Stock Card state
  const [stockCardVariantId, setStockCardVariantId] = useState("");
  const [stockCardFrom, setStockCardFrom] = useState("");
  const [stockCardTo, setStockCardTo] = useState("");
  const [stockCardLoading, setStockCardLoading] = useState(false);
  const [stockCardData, setStockCardData] = useState<StockCardReportData | null>(null);

  const currentDef = REPORT_DEFS.find((d) => d.type === selectedReportType);
  const needsRange = currentDef?.needsRange ?? true;

  const handleReportClick = (reportType: string) => {
    if (reportType === "stockCardReport") {
      setSelectedReportType(reportType);
      setStockCardData(null);
      return;
    }
    setSelectedReportType(reportType);
    setStartDate("");
    setEndDate("");
    setSelectedStall("all");
    setIsDatePickerOpen(true);
  };

  const handleLoadStockCard = async () => {
    if (!stockCardVariantId || !stockCardFrom || !stockCardTo) {
      toast.error(t("reports.stockCard.fillAll"));
      return;
    }
    setStockCardLoading(true);
    try {
      const data = await api.get<StockCardReportData>(
        `/reports/stock-card?product_variant_id=${encodeURIComponent(stockCardVariantId)}&date_from=${stockCardFrom}&date_to=${stockCardTo}`,
      );
      setStockCardData(data);
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : t("shopUsers.errorGeneric");
      toast.error(detail);
    } finally {
      setStockCardLoading(false);
    }
  };

  const handleExportStockCard = () => {
    if (!stockCardData) return;
    const { product_name, sku, date_from, date_to, opening_balance, rows, closing_balance } = stockCardData;
    let csv = `${t("reports.stockCardReport")}\n`;
    csv += `${t("reports.stockCard.product")}: ${csvEscape(product_name)} (SKU: ${csvEscape(sku)})\n`;
    csv += `${t("reports.startDate")}: ${date_from}  ${t("reports.endDate")}: ${date_to}\n`;
    csv += `${t("reports.stockCard.openingBalance")}: ${opening_balance}\n\n`;
    csv += `${t("reports.colDate")},${t("reports.stockCard.colType")},${t("reports.colQuantity")},${t("reports.stockCard.colRunning")},${t("reports.stockCard.colReference")},${t("reports.stockCard.colNotes")}\n`;
    for (const r of rows) {
      csv += `${r.date.slice(0, 19).replace("T", " ")},${csvEscape(r.movement_type)},${r.quantity},${r.running_balance},${csvEscape(r.reference)},${csvEscape(r.notes)}\n`;
    }
    csv += `\n${t("reports.stockCard.closingBalance")},,,${closing_balance},,\n`;
    downloadCsv(`StockCard_${sku}_${date_from}_${date_to}.csv`, csv);
    toast.success(t("reports.exportSuccess"));
  };

  // Build scope query param
  const shopParam = (() => {
    if (user?.role === "admin") return "";
    if (isCanteenAreaMgr) {
      return selectedStall === "all"
        ? "&module=canteen"
        : `&shop_id=${encodeURIComponent(selectedStall)}`;
    }
    return user?.shopId ? `&shop_id=${encodeURIComponent(user.shopId)}` : "";
  })();

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
          if (r.payment_method.toUpperCase() === "DEPARTMENT") continue;
          const methodLabel = t(`payment.${r.payment_method}`) || r.payment_method;
          csv += `${csvEscape(methodLabel)},${r.receipt_count},${r.total.toFixed(2)}\n`;
        }
        csv += `\n${t("reports.grandTotal")},,${data.retail_total.toFixed(2)}\n`;
        csv += `${t("reports.totalReceipts") || "Total Receipts"},${data.total_receipts - data.department_receipts},\n`;
        csv += `\nDepartment Use (Internal) — ยอดเบิกภายใน,,\n`;
        csv += `Department Use,${data.department_receipts},${data.department_total.toFixed(2)}\n`;
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

      {/* Stock Card inline panel */}
      {selectedReportType === "stockCardReport" && (
        <div className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-primary" />
                {t("reports.stockCardReport")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="scVariantId">{t("reports.stockCard.variantId")}</Label>
                  <Input
                    id="scVariantId"
                    type="number"
                    min={1}
                    placeholder="1"
                    value={stockCardVariantId}
                    onChange={(e) => setStockCardVariantId(e.target.value)}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>{t("reports.startDate")} — {t("reports.endDate")}</Label>
                  <DateRangePicker
                    id="scDateRange"
                    startDate={stockCardFrom}
                    endDate={stockCardTo}
                    onStartChange={setStockCardFrom}
                    onEndChange={setStockCardTo}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleLoadStockCard} disabled={stockCardLoading}>
                  {stockCardLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  {t("reports.stockCard.load")}
                </Button>
                {stockCardData && (
                  <Button variant="outline" onClick={handleExportStockCard}>
                    <FileDown className="h-4 w-4 mr-2" />
                    {t("reports.exportExcel")}
                  </Button>
                )}
              </div>

              {stockCardData && (
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium">{stockCardData.product_name}</span>
                    {" · SKU: "}{stockCardData.sku}
                  </div>
                  <div className="rounded-md border p-3 bg-secondary/50 text-sm flex justify-between">
                    <span>{t("reports.stockCard.openingBalance")}</span>
                    <span className="font-semibold">{stockCardData.opening_balance}</span>
                  </div>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left">{t("reports.colDate")}</th>
                          <th className="px-3 py-2 text-left">{t("reports.stockCard.colType")}</th>
                          <th className="px-3 py-2 text-right">{t("reports.colQuantity")}</th>
                          <th className="px-3 py-2 text-right">{t("reports.stockCard.colRunning")}</th>
                          <th className="px-3 py-2 text-left">{t("reports.stockCard.colReference")}</th>
                          <th className="px-3 py-2 text-left">{t("reports.stockCard.colNotes")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockCardData.rows.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                              {t("reports.stockCard.noMovements")}
                            </td>
                          </tr>
                        ) : (
                          stockCardData.rows.map((row, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-3 py-2 whitespace-nowrap">{row.date.slice(0, 19).replace("T", " ")}</td>
                              <td className="px-3 py-2">{row.movement_type}</td>
                              <td className={`px-3 py-2 text-right font-mono ${row.quantity >= 0 ? "text-green-600" : "text-red-600"}`}>
                                {row.quantity >= 0 ? "+" : ""}{row.quantity}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">{row.running_balance}</td>
                              <td className="px-3 py-2">{row.reference ?? "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground">{row.notes ?? ""}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-md border p-3 bg-primary/5 text-sm flex justify-between font-medium">
                    <span>{t("reports.stockCard.closingBalance")}</span>
                    <span className="font-semibold">{stockCardData.closing_balance}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

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
            {isCanteenAreaMgr && (
              <div className="space-y-2">
                <Label>{t("reports.canteenScope")}</Label>
                <Select value={selectedStall} onValueChange={setSelectedStall}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("reports.canteenScopeAll")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("reports.canteenScopeAll")}</SelectItem>
                    {canteenStalls.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

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

            {selectedReportType === "salesByPaymentReport" && (
              <div className="border border-dashed border-muted-foreground/40 bg-muted/40 rounded-lg p-3 space-y-1">
                <p className="text-sm font-semibold text-muted-foreground">
                  Department Use (Internal)
                </p>
                <p className="text-xs text-muted-foreground">
                  ยอดเบิกภายใน (Department Use) แยกจากยอดขายปกติ
                </p>
                <p className="text-xs text-muted-foreground">
                  Grand Total ในรายงานนี้แสดงเฉพาะยอดขายปกติ — ไม่รวม Department Use
                </p>
              </div>
            )}
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
